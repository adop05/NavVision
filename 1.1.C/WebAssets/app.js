/**
 * NavVision - Spatial Awareness & Navigation Assistant
 * Frontend & Hardware Bridge Logic
 * Core logic managing camera, audio TTS, mapbox routing, and backend API interactions
 */

// Global State
const state = {
    backendUrl: 'http://localhost:5000',
    mapboxToken: '',
    streamFps: 5,
    confidence: 45,
    gpsMode: 'simulated',
    isScanning: false,
    sonarMuted: false,
    speechMuted: false,
    simStartCoords: [28.538336, -81.379234], // Lat, Lon
    simDestCoords: [28.542892, -81.377317],  // Lat, Lon
};

// -------------------------------------------------------------
// 1. Speech Manager (Text-to-Speech Queue)
// -------------------------------------------------------------
class SpeechManager {
    constructor() {
        this.synth = window.speechSynthesis;
        this.queue = [];
        this.speaking = false;
        this.unlocked = false;

        // iOS Safari TTS Unlocker
        // Apple requires the speech engine to be initialized synchronously during the very first user interaction
        const unlock = () => {
            if (this.unlocked || !this.synth) return;
            const u = new SpeechSynthesisUtterance('');
            u.volume = 0; // Silent unlock
            this.synth.speak(u);
            this.unlocked = true;
            document.removeEventListener('touchstart', unlock);
            document.removeEventListener('click', unlock);
        };
        document.addEventListener('touchstart', unlock, { once: true, passive: true });
        document.addEventListener('click', unlock, { once: true, passive: true });
    }

    speak(text, priority = false) {
        if (state.speechMuted) {
            this.logToConsole(`[Muted Speech] ${text}`, 'system-msg');
            return;
        }

        this.logToConsole(text, 'tts-msg');

        if (!this.synth) {
            this.logToConsole("[Speech] TTS not supported in browser", "system-msg");
            return;
        }

        if (priority) {
            try { this.synth.cancel(); } catch(e) {}
            this.queue = [];
            this.speaking = false;
        }

        let utterance;
        try {
            utterance = new SpeechSynthesisUtterance(text);
        } catch (e) {
            this.logToConsole("[Speech] SpeechSynthesisError: " + e.message, "system-msg");
            return;
        }
        
        utterance.onend = () => {
            this.speaking = false;
            this.processQueue();
        };

        utterance.onerror = (e) => {
            console.error("Speech Synthesis Error:", e);
            this.speaking = false;
            this.processQueue();
        };

        try {
            if (priority) {
                this.speaking = true;
                this.synth.speak(utterance);
            } else {
                this.queue.push(utterance);
                if (!this.speaking) {
                    this.processQueue();
                }
            }
        } catch (e) {
            console.warn("Speech synthesis error:", e);
            this.speaking = false;
            this.processQueue();
        }
    }

    processQueue() {
        if (this.queue.length === 0 || this.speaking) return;
        this.speaking = true;
        const nextUtterance = this.queue.shift();
        try {
            this.synth.speak(nextUtterance);
        } catch (e) {
            console.warn("Speech synthesis error:", e);
            this.speaking = false;
            this.processQueue();
        }
    }

    stop() {
        try { this.synth.cancel(); } catch(e) {}
        this.queue = [];
        this.speaking = false;
    }

    logToConsole(msg, typeClass = 'system-msg') {
        const consoleEl = document.getElementById('log-console');
        if (!consoleEl) return;
        
        // Only display the single most recent message to keep the box compact
        consoleEl.innerHTML = `<div class="log-entry ${typeClass}">${msg}</div>`;
    }
}

const speech = new SpeechManager();

// -------------------------------------------------------------
// 2. Sonar Synthesizer (Web Audio API)
// -------------------------------------------------------------
class SonarSynthesizer {
    constructor() {
        this.timeoutId = null;
        this.distance = Infinity; // Infinite distance initially

        // Distance thresholds (meters) and label-update interval range (ms).
        // The actual beep + haptic feedback now happens natively in Swift
        // (see ProximityAlertController.swift) — iOS requires AudioContext
        // to be unlocked during a genuine user touch, and distance updates
        // arrive here via a native bridge call rather than a real DOM
        // event, so Web Audio playback was never reliable. This class now
        // only drives the on-screen hazard label at the same cadence the
        // native beep uses, so they stay visually in sync.
        this.startDistance = 2.0;      // hazard label appears within this range
        this.criticalDistance = 0.30;  // fastest label-update rate at/below this
        this.slowestInterval = 1000;   // ms, at startDistance
        this.fastestInterval = 80;     // ms, at/below criticalDistance
    }

    setDistance(d) {
        const prevDistance = this.distance;
        this.distance = d;

        // If distance was out of range and now it's close, trigger tick cycle
        if (prevDistance >= this.startDistance && d < this.startDistance) {
            this.tick();
        }
    }

    tick() {
        if (state.sonarMuted || this.distance >= this.startDistance) {
            this.timeoutId = null;
            return;
        }

        const dClamped = Math.max(this.criticalDistance, Math.min(this.startDistance, this.distance));
        const normalized = (dClamped - this.criticalDistance) / (this.startDistance - this.criticalDistance); // 0 (close) to 1 (far)
        const interval = this.fastestInterval + normalized * (this.slowestInterval - this.fastestInterval);

        this.animateRadarPing(dClamped);

        this.timeoutId = setTimeout(() => this.tick(), interval);
    }

    animateRadarPing(distance) {
        const ring = document.getElementById('radar-ping-ring');
        if (!ring) return;

        // Visual animation removed as requested

        // Update Text Label
        const label = document.getElementById('sonar-distance-label');
        if (label) {
            if (distance < this.startDistance) {
                label.textContent = `HAZARD: ${distance.toFixed(2)}m`;
                // Color severity split proportionally across the active
                // range (criticalDistance to startDistance) rather than
                // fixed absolute breakpoints, so it scales sensibly if
                // startDistance/criticalDistance are ever tuned.
                const range = this.startDistance - this.criticalDistance;
                const closeThreshold = this.criticalDistance + range * 0.33;
                const midThreshold = this.criticalDistance + range * 0.66;
                label.style.color = distance < closeThreshold ? 'var(--red)' : (distance < midThreshold ? 'var(--yellow)' : 'var(--cyan)');
                label.style.textShadow = distance < closeThreshold ? '0 0 10px var(--red)' : (distance < midThreshold ? '0 0 10px var(--yellow)' : '0 0 10px var(--cyan)');
            } else {
                label.textContent = "No Object Detected";
                label.style.color = 'var(--cyan)';
                label.style.textShadow = '0 0 5px var(--cyan)';
            }
        }
    }

    stop() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
}

const sonar = new SonarSynthesizer();

// -------------------------------------------------------------
// 3. Navigation & Mapbox Manager
// -------------------------------------------------------------
class NavigationManager {
    constructor() {
        this.map = null;
        this.routeLine = null;
        this.marker = null;
        this.routeGeoJSON = null;
        this.steps = [];
        this.currentStepIndex = 0;
        this.gpsWatchId = null;
        
        this.simulationTimer = null;
        this.simRouteCoords = [];
        this.simRouteIndex = 0;
    }

    initializeMap() {
        const mapContainer = document.getElementById('mapbox-container');
        if (!mapContainer) return;

        // Check for Token
        if (!state.mapboxToken) {
            this.showMapFallback("Mapbox Token missing. Set it in Settings to render maps & routes.");
            speech.logToConsole("Mapbox configuration required for routing.", "system-msg");
            return;
        }

        // Hide fallback loading screen
        const loader = document.getElementById('map-loading-screen');
        if (loader) loader.style.display = 'none';

        try {
            mapboxgl.accessToken = state.mapboxToken;
            this.map = new mapboxgl.Map({
                container: 'mapbox-container',
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [state.simStartCoords[1], state.simStartCoords[0]], // Longitude, Latitude
                zoom: 15,
                pitch: 45
            });

            this.map.on('load', () => {
                speech.logToConsole("Mapbox loaded successfully.", "system-msg");
                
                // Add marker
                this.marker = new mapboxgl.Marker({
                    color: "var(--cyan)",
                    draggable: false
                })
                .setLngLat([state.simStartCoords[1], state.simStartCoords[0]])
                .addTo(this.map);

                // Auto initialize simulated route if set
                if (state.gpsMode === 'simulated') {
                    this.fetchWalkingRoute();
                } else {
                    this.startRealGPSWatch();
                }
            });

            this.map.on('error', (e) => {
                console.error("Mapbox error:", e);
                this.showMapFallback("Mapbox initialization error. Verify your Token.");
            });

        } catch (e) {
            console.error("Failed to boot MapboxGL:", e);
            this.showMapFallback("Failed to load map interface.");
        }
    }

    showMapFallback(msg) {
        const container = document.getElementById('mapbox-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="map-loading" style="padding: 1.5rem; text-align: center;">
                <i class="fa-solid fa-triangle-exclamation" style="color: var(--yellow); font-size: 2rem; margin-bottom: 0.5rem;"></i>
                <p>${msg}</p>
            </div>
        `;
    }

    setGPSMode(mode) {
        state.gpsMode = mode;
        
        // Stop current tracking
        this.stopRealGPSWatch();
        this.stopSimulation();

        if (mode === 'real') {
            this.startRealGPSWatch();
        } else {
            this.fetchWalkingRoute();
        }
    }

    startRealGPSWatch() {
        if (!navigator.geolocation) {
            speech.speak("Geolocation is not supported by your browser.");
            return;
        }

        const options = {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        };

        this.gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                this.updatePosition(lat, lon);
            },
            (err) => {
                console.warn(`Geolocation Error (${err.code}): ${err.message}`);
                speech.logToConsole(`GPS Error: ${err.message}. Fallback to simulated route.`, "system-msg");
            },
            options
        );
    }

    stopRealGPSWatch() {
        if (this.gpsWatchId !== null) {
            navigator.geolocation.clearWatch(this.gpsWatchId);
            this.gpsWatchId = null;
        }
    }

    async fetchWalkingRoute() {
        if (!state.mapboxToken) return;

        const start = `${state.simStartCoords[1]},${state.simStartCoords[0]}`;
        const end = `${state.simDestCoords[1]},${state.simDestCoords[0]}`;
        const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${start};${end}?steps=true&geometries=geojson&access_token=${state.mapboxToken}`;

        try {
            speech.logToConsole("Fetching walking route from Mapbox...", "system-msg");
            const response = await fetch(url);
            const data = await response.json();

            if (data.code !== 'Ok') {
                throw new Error(data.message || 'Route query failed');
            }

            const route = data.routes[0];
            this.routeGeoJSON = route.geometry;
            this.steps = route.legs[0].steps;
            this.currentStepIndex = 0;

            speech.logToConsole(`Route found: ${(route.distance / 1000).toFixed(2)} km.`, "system-msg");
            
            // Draw route on map
            this.drawRouteLine(this.routeGeoJSON);
            
            // Display first step instruction
            this.displayStep();
            
            // Start TTS introduction
            const startText = `Route initialized. Walking route is ${(route.distance).toFixed(0)} meters long. ${this.steps[0].maneuver.instruction}`;
            speech.speak(startText, true);

            // Populate simulation coordinates array
            if (state.gpsMode === 'simulated') {
                this.simRouteCoords = this.routeGeoJSON.coordinates;
                this.startSimulation();
            }

        } catch (e) {
            console.error("Routing error:", e);
            speech.logToConsole(`Failed to fetch route: ${e.message}`, "system-msg");
        }
    }

    drawRouteLine(geojson) {
        if (!this.map) return;

        const sourceId = 'route';

        if (this.map.getSource(sourceId)) {
            this.map.getSource(sourceId).setData(geojson);
        } else {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: geojson
            });

            this.map.addLayer({
                id: 'route-line',
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#00f0ff',
                    'line-width': 5,
                    'line-opacity': 0.75
                }
            });
        }

        // Fit map bounds
        const coordinates = geojson.coordinates;
        const bounds = coordinates.reduce((acc, coord) => {
            return acc.extend(coord);
        }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

        this.map.fitBounds(bounds, { padding: 50 });
    }

    displayStep() {
        if (this.steps.length === 0) return;
        const currentStep = this.steps[this.currentStepIndex];
        
        document.getElementById('nav-instruction').textContent = currentStep.maneuver.instruction;
        document.getElementById('nav-distance').textContent = `${currentStep.distance.toFixed(0)} m`;
        document.getElementById('nav-duration').textContent = `${Math.ceil(currentStep.duration / 60)} min`;
        
        // Update instruction icon
        const iconContainer = document.getElementById('nav-step-icon');
        if (iconContainer) {
            const type = currentStep.maneuver.type;
            const modifier = currentStep.maneuver.modifier;
            iconContainer.innerHTML = this.getDirectionIcon(type, modifier);
        }
    }

    getDirectionIcon(type, modifier) {
        if (type.includes('turn')) {
            if (modifier && modifier.includes('right')) return '<i class="fa-solid fa-arrow-turn-down fa-rotate-270"></i>';
            if (modifier && modifier.includes('left')) return '<i class="fa-solid fa-arrow-turn-up fa-rotate-90"></i>';
        }
        if (type.includes('arrive')) return '<i class="fa-solid fa-circle-check"></i>';
        if (type.includes('depart')) return '<i class="fa-solid fa-play"></i>';
        return '<i class="fa-solid fa-location-arrow"></i>';
    }

    updatePosition(lat, lon) {
        if (this.marker) {
            this.marker.setLngLat([lon, lat]);
        }
        if (this.map) {
            this.map.easeTo({ center: [lon, lat], zoom: 18 });
        }

        // Check distance to upcoming waypoint step
        if (this.steps.length > 0 && this.currentStepIndex < this.steps.length) {
            const nextStep = this.steps[this.currentStepIndex];
            const stepLoc = nextStep.maneuver.location; // [lon, lat]
            
            const distanceToNext = this.getHaversineDistance(lat, lon, stepLoc[1], stepLoc[0]);
            
            // Update display distance
            document.getElementById('nav-distance').textContent = `${distanceToNext.toFixed(0)} m`;

            // If close (within 10 meters), advance step and announce instruction
            if (distanceToNext < 10) {
                this.currentStepIndex++;
                if (this.currentStepIndex < this.steps.length) {
                    const inst = this.steps[this.currentStepIndex].maneuver.instruction;
                    speech.speak(inst, true);
                    this.displayStep();
                } else {
                    speech.speak("You have arrived at your destination.", true);
                    document.getElementById('nav-instruction').textContent = "Arrived at destination.";
                    this.stopSimulation();
                }
            }
        }
    }

    getHaversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth radius in meters
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const deltaPhi = (lat2 - lat1) * Math.PI / 180;
        const deltaLambda = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // in meters
    }

    startSimulation() {
        this.stopSimulation();
        this.simRouteIndex = 0;
        this.simulating = true;
        speech.logToConsole("Starting Route Simulator.", "system-msg");

        const advanceSim = () => {
            if (!this.simulating || this.simRouteCoords.length === 0) return;
            
            const currentPoint = this.simRouteCoords[this.simRouteIndex];
            // Update position
            this.updatePosition(currentPoint[1], currentPoint[0]);

            this.simRouteIndex++;
            if (this.simRouteIndex < this.simRouteCoords.length) {
                // Move coordinates along path at speed of ~1 point per 1.5 seconds
                this.simulationTimer = setTimeout(advanceSim, 1500);
            } else {
                this.simulating = false;
                speech.logToConsole("Route simulation complete.", "system-msg");
            }
        };

        advanceSim();
    }

    stopSimulation() {
        this.simulating = false;
        if (this.simulationTimer) {
            clearTimeout(this.simulationTimer);
            this.simulationTimer = null;
        }
    }
}

const navigation = new NavigationManager();

// -------------------------------------------------------------
// 4. Camera & Sensor Manager (native ARKit/LiDAR bridge)
// -------------------------------------------------------------
//
// The camera feed and obstacle distance now come from native code (ARKit +
// LiDAR), not getUserMedia + a Flask backend. This class just requests
// native to start/stop the ARSession; native pushes back distance readings
// and scanner state changes via the window.native* functions below it.
//
// Why: ARKit needs exclusive access to the camera to provide LiDAR depth
// data, so getUserMedia can no longer be used for the visual feed — the
// video-feed element is hidden (see index.html/style.css) and a native
// ARSCNView shows the passthrough camera behind the transparent
// .camera-radar-container element instead.
class CameraManager {
    toggleScanner() {
        sendNativeCommand('toggleScanner');
    }
}

const camera = new CameraManager();

// -------------------------------------------------------------
// 4b. Native Bridge — JS <-> Swift communication
// -------------------------------------------------------------

/**
 * Sends a command to native Swift code via WKScriptMessageHandler.
 * Falls back to a console log when running outside the native app (e.g.
 * testing the UI in a regular desktop browser), so nothing throws.
 */
function sendNativeCommand(command, value) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeBridge) {
        window.webkit.messageHandlers.nativeBridge.postMessage({ command: command, value: value });
    } else {
        console.log('(not running in native app) would send command:', command, value);
    }
}

/**
 * Called by native code every time a new LiDAR depth reading is available.
 * Feeds directly into the existing SonarSynthesizer — its distance->pitch/
 * rate mapping, the hazard label, and the mute toggle (state.sonarMuted,
 * checked inside sonar.tick()) all keep working exactly as built.
 *
 * @param {number|null} distanceMeters
 */
window.nativeUpdateDistance = function (distanceMeters) {
    const distance = (distanceMeters === null || distanceMeters === undefined) ? Infinity : distanceMeters;
    sonar.setDistance(distance);

    // Voice announcement for close hazards. Throttled so TTS doesn't talk
    // constantly while something stays within range. This replaces the old
    // Flask detections.forEach(...) block, minus the object class name
    // (LiDAR gives distance only, no classification).
    if (distance < sonar.startDistance && !state.speechMuted) {
        maybeAnnounceHazard(distance);
    }
};

let lastHazardAnnounceTime = 0;
function maybeAnnounceHazard(distance) {
    const now = Date.now();
    if (now - lastHazardAnnounceTime > 4000) {
        lastHazardAnnounceTime = now;
        speech.speak(`Obstacle ${distance.toFixed(1)} meters ahead.`, false);
        speech.logToConsole(`HAZARD: obstacle at ${distance.toFixed(1)}m`, 'hazard-msg');
    }
}

/**
 * Called by native code whenever ARKit's tracking quality changes. Purely
 * informational — logs to the console so it's visible during testing.
 * @param {string} trackingState e.g. "normal", "limitedExcessiveMotion", etc.
 */
window.nativeUpdateTrackingState = function (trackingState) {
    if (trackingState !== 'normal') {
        speech.logToConsole(`Tracking: ${trackingState}`, 'system-msg');
    }
};

/**
 * Called by native code after it actually starts/stops the ARSession in
 * response to a "toggleScanner" command, so the UI reflects the real
 * native state rather than assuming the command succeeded.
 * @param {boolean} isScanning
 */
window.nativeScannerStateChanged = function (isScanning) {
    state.isScanning = isScanning;
    const btn = document.getElementById('btn-scan-toggle');

    if (isScanning) {
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
        btn.classList.add('btn-stop');
        document.querySelector('.app-header').classList.add('camera-active');
        speech.speak('Sensor activated.');
    } else {
        btn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        btn.classList.remove('btn-stop');
        document.querySelector('.app-header').classList.remove('camera-active');
        sonar.stop();
        sonar.setDistance(Infinity);
        speech.speak('Sensor deactivated.');
    }
};

// -------------------------------------------------------------
// 5. ConfigManager (Settings & Modal Wiring)
// -------------------------------------------------------------
class ConfigManager {
    constructor() {
        this.modal = document.getElementById('settings-modal');
        this.btnOpen = document.getElementById('btn-toggle-settings');
        this.btnClose = document.getElementById('btn-close-settings');
        this.btnSave = document.getElementById('btn-save-settings');
        
        this.inputBackend = document.getElementById('input-backend-url');
        this.inputFps = document.getElementById('input-fps');
        this.inputConfidence = document.getElementById('input-confidence');
        this.inputToken = document.getElementById('input-mapbox-token');
        this.selectGps = document.getElementById('select-gps-mode');
        
        this.simLatStart = document.getElementById('sim-start-lat');
        this.simLonStart = document.getElementById('sim-start-lon');
        this.simLatEnd = document.getElementById('sim-end-lat');
        this.simLonEnd = document.getElementById('sim-end-lon');
        this.btnSimTrigger = document.getElementById('btn-trigger-simulation');

        this.testDistance = document.getElementById('range-test-distance');
        this.lblTestDistance = document.getElementById('lbl-test-distance');
    }

    load() {
        // Read stored configuration
        const storedBackend = localStorage.getItem('navvision_backend');
        const storedToken = localStorage.getItem('navvision_token');
        const storedFps = localStorage.getItem('navvision_fps');
        const storedConf = localStorage.getItem('navvision_conf');
        const storedGpsMode = localStorage.getItem('navvision_gps_mode');
        
        if (storedBackend) state.backendUrl = storedBackend;
        if (storedToken) state.mapboxToken = storedToken;
        if (storedFps) state.streamFps = parseInt(storedFps);
        if (storedConf) state.confidence = parseInt(storedConf);
        if (storedGpsMode) state.gpsMode = storedGpsMode;

        // Apply to inputs
        this.inputBackend.value = state.backendUrl;
        this.inputToken.value = state.mapboxToken;
        this.inputFps.value = state.streamFps;
        this.inputConfidence.value = state.confidence;
        document.getElementById('confidence-val').textContent = `${state.confidence}%`;
        this.selectGps.value = state.gpsMode;

        this.toggleGpsCoordinatesPanel();
    }

    save() {
        state.backendUrl = this.inputBackend.value.trim();
        state.mapboxToken = this.inputToken.value.trim();
        state.streamFps = parseInt(this.inputFps.value);
        state.confidence = parseInt(this.inputConfidence.value);
        
        localStorage.setItem('navvision_backend', state.backendUrl);
        localStorage.setItem('navvision_token', state.mapboxToken);
        localStorage.setItem('navvision_fps', state.streamFps);
        localStorage.setItem('navvision_conf', state.confidence);

        // Update GPS Mode
        const newGpsMode = this.selectGps.value;
        localStorage.setItem('navvision_gps_mode', newGpsMode);
        navigation.setGPSMode(newGpsMode);

        // Re-read simulation coords
        state.simStartCoords = [parseFloat(this.simLatStart.value), parseFloat(this.simLonStart.value)];
        state.simDestCoords = [parseFloat(this.simLatEnd.value), parseFloat(this.simLonEnd.value)];

        speech.speak("Settings saved successfully.");
        speech.logToConsole("Settings saved and configuration updated.", "system-msg");
        
        this.closeModal();

        // Hot reload Mapbox if token was added
        if (state.mapboxToken && !navigation.map) {
            navigation.initializeMap();
        }
    }

    openModal() {
        this.modal.style.display = 'flex';
    }

    closeModal() {
        this.modal.style.display = 'none';
    }

    toggleGpsCoordinatesPanel() {
        const panel = document.getElementById('simulation-coordinates-panel');
        if (this.selectGps.value === 'simulated') {
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    }

    wireEvents() {
        this.btnOpen.addEventListener('click', () => this.openModal());
        this.btnClose.addEventListener('click', () => this.closeModal());
        this.btnSave.addEventListener('click', () => this.save());
        
        this.selectGps.addEventListener('change', () => this.toggleGpsCoordinatesPanel());
        
        this.inputConfidence.addEventListener('input', (e) => {
            document.getElementById('confidence-val').textContent = `${e.target.value}%`;
        });

        // Trigger manual route reload in simulator
        this.btnSimTrigger.addEventListener('click', () => {
            state.simStartCoords = [parseFloat(this.simLatStart.value), parseFloat(this.simLonStart.value)];
            state.simDestCoords = [parseFloat(this.simLatEnd.value), parseFloat(this.simLonEnd.value)];
            this.closeModal();
            navigation.fetchWalkingRoute();
        });

        // Sonar Hazard Slider Simulation Hook
        this.testDistance.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (val >= sonar.startDistance) {
                this.lblTestDistance.textContent = 'Infinite';
                sonar.setDistance(Infinity);
            } else {
                this.lblTestDistance.textContent = `${val.toFixed(2)}m`;
                sonar.setDistance(val);
            }
        });
    }
}

const config = new ConfigManager();

// -------------------------------------------------------------
// 6. UI Interaction & Event Wiring
// -------------------------------------------------------------

function triggerHaptic(pattern = 100) {
    if (navigator && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

function wireUIEvents() {
    // Start / Stop Scanner Button
    document.getElementById('btn-scan-toggle').addEventListener('click', () => {
        triggerHaptic([100, 50, 100]); // Distinct pattern for main action
        camera.toggleScanner();
    });

    // Sonar Ticks Toggle Mute Button
    document.getElementById('btn-mute-sonar').addEventListener('click', (e) => {
        triggerHaptic(50);
        const btn = e.currentTarget;
        state.sonarMuted = !state.sonarMuted;
        sendNativeCommand('setSonarMuted', state.sonarMuted);
        if (btn.classList.contains('active')) {
            btn.classList.remove('active');
            btn.classList.add('btn-stop');
            speech.speak("Distance alert muted.");
        } else {
            btn.classList.add('active');
            btn.classList.remove('btn-stop');
            speech.speak("Distance alert unmuted.");
        }
        
        if (state.sonarMuted) {
            sonar.stop();
        } else {
            if (sonar.distance < 6.0) {
                sonar.tick();
            }
        }
    });

    // Speech Voice Toggle Mute Button
    document.getElementById('btn-mute-speech').addEventListener('click', (e) => {
        triggerHaptic(50);
        const btn = e.currentTarget;
        state.speechMuted = !state.speechMuted;
        btn.classList.toggle('active', !state.speechMuted);
        
        if (state.speechMuted) {
            speech.stop();
            // Just write to console since synth is muted
            speech.logToConsole("Voice speech feedback deactivated.", "system-msg");
        } else {
            state.speechMuted = false;
            speech.speak("Voice speech feedback activated.");
        }
    });

    // Emergency Button (Long Press to trigger)
    const btnEmergency = document.getElementById('btn-emergency');
    let emergencyTimer = null;

    if (btnEmergency) {
        const triggerEmergency = () => {
            btnEmergency.classList.add('btn-emergency-active'); // Flash Red
            
            // Force speech even if muted
            const wasMuted = state.speechMuted;
            state.speechMuted = false;
            speech.speak("Emergency triggered. Calling 9 1 1.", true);
            state.speechMuted = wasMuted;
            
            // Revert visual state after 4 seconds
            setTimeout(() => {
                btnEmergency.classList.remove('btn-emergency-active');
            }, 4000);
        };

        const startEmergencyTimer = (e) => {
            // Start continuous vibration for the duration of the hold
            if (navigator && navigator.vibrate) navigator.vibrate(1500); 
            emergencyTimer = setTimeout(triggerEmergency, 1500); // 1.5 seconds to trigger
        };

        const cancelEmergencyTimer = () => {
            if (emergencyTimer) {
                clearTimeout(emergencyTimer);
                emergencyTimer = null;
                // Cancel vibration if they let go early
                if (navigator && navigator.vibrate) navigator.vibrate(0);
            }
        };

        // Touch events
        btnEmergency.addEventListener('touchstart', startEmergencyTimer, {passive: true});
        btnEmergency.addEventListener('touchend', cancelEmergencyTimer, {passive: true});
        btnEmergency.addEventListener('touchcancel', cancelEmergencyTimer, {passive: true});
        
        // Mouse events (for testing on desktop)
        btnEmergency.addEventListener('mousedown', startEmergencyTimer);
        btnEmergency.addEventListener('mouseup', cancelEmergencyTimer);
        btnEmergency.addEventListener('mouseleave', cancelEmergencyTimer);
    }

// Clear Logs logic removed by request
}

// Custom Pull-to-Refresh Logic
function initPullToRefresh() {
    let touchStartY = 0;
    let touchMoveY = 0;
    const ptrIndicator = document.getElementById('ptr-indicator');
    if (!ptrIndicator) return;

    document.addEventListener('touchstart', (e) => {
        // Do not allow pull-to-refresh if the settings modal is open
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.style.display !== 'none') return;

        if (window.scrollY === 0) {
            touchStartY = e.touches[0].clientY;
        }
    }, {passive: true});

    document.addEventListener('touchmove', (e) => {
        if (touchStartY === 0) return;
        touchMoveY = e.touches[0].clientY;
        let pullDistance = touchMoveY - touchStartY;
        
        // If pulling down
        if (pullDistance > 0) {
            // Apply resistance to the pull
            let height = Math.min(pullDistance * 0.4, 80); 
            ptrIndicator.style.height = height + 'px';
            ptrIndicator.style.transition = 'none'; // Disable transition while dragging
        }
    }, {passive: true});

    document.addEventListener('touchend', (e) => {
        if (touchStartY === 0) return;
        let pullDistance = touchMoveY - touchStartY;
        
        ptrIndicator.style.transition = 'height 0.2s ease-out';
        
        if (pullDistance > 150) { // Threshold reached
            ptrIndicator.style.height = '60px'; // Lock open while reloading
            ptrIndicator.innerHTML = '<i class="fa-solid fa-rotate-right fa-spin" style="color: var(--color-on); font-size: 1.5rem;"></i>';
            setTimeout(() => {
                window.location.reload();
            }, 400);
        } else {
            ptrIndicator.style.height = '0px'; // Snap back
        }
        
        touchStartY = 0;
        touchMoveY = 0;
    });
}

// -------------------------------------------------------------
// 7. Initialization Lifecycle
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // Load config values
    config.load();
    config.wireEvents();
    
    // Wire main control panels
    wireUIEvents();

    // Setup Custom Pull-to-Refresh for Strict Layout
    initPullToRefresh();

    speech.logToConsole("NavVision Spatial Bridge fully loaded.", "system-msg");

    // Initialize Mapbox with delay to ensure browser rendering resolves
    setTimeout(() => {
        navigation.initializeMap();
    }, 500);
});
