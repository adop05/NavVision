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
    currentLat: null,
    currentLong: null
};

// -------------------------------------------------------------
// 1. Speech Manager (Text-to-Speech Queue)
// -------------------------------------------------------------
class SpeechManager {
    constructor() {
        this.synth = window.speechSynthesis;
        this.queue = [];
        this.speaking = false;
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
        this.audioCtx = null;
        this.timeoutId = null;
        this.distance = Infinity; // Infinite distance initially
    }

    init() {
        if (this.audioCtx) return;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    setDistance(d) {
        const prevDistance = this.distance;
        this.distance = d;

        // If distance was infinite and now it's close, trigger tick cycle
        if (prevDistance >= 6.0 && d < 6.0) {
            this.tick();
        }
    }

    tick() {
        if (state.sonarMuted || this.distance >= 6.0) {
            this.timeoutId = null;
            return;
        }

        this.init(); // Lazy init AudioContext on first user interaction

        // Calculate ticking speed & pitch based on distance (0.2m to 6.0m)
        // Closer objects (e.g. 0.2m) yield high pitch (1000Hz) and short delay (100ms)
        // Farther objects (e.g. 5.5m) yield lower pitch (300Hz) and long delay (1000ms)
        const dClamped = Math.max(0.2, Math.min(6.0, this.distance));
        const normalized = (dClamped - 0.2) / 5.8; // 0 to 1

        const interval = 80 + normalized * 920;    // 80ms to 1000ms
        const pitch = 950 - normalized * 650;      // 950Hz to 300Hz

        this.playBeep(pitch, 0.04);
        this.animateRadarPing(dClamped);

        this.timeoutId = setTimeout(() => this.tick(), interval);
    }

    playBeep(frequency, duration) {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();

            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

            gainNode.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
            // Quick decay for a clean "tick" sound
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

            osc.start();
            osc.stop(this.audioCtx.currentTime + duration);
        } catch (e) {
            console.error("Synthesizer failed to beep:", e);
        }
    }

    animateRadarPing(distance) {
        const ring = document.getElementById('radar-ping-ring');
        if (!ring) return;

        // Visual animation removed as requested

        // Update Text Label
        const label = document.getElementById('sonar-distance-label');
        if (label) {
            if (distance < 6.0) {
                label.textContent = `HAZARD: ${distance.toFixed(1)}m`;
                label.style.color = distance < 1.5 ? 'var(--red)' : (distance < 3.5 ? 'var(--yellow)' : 'var(--cyan)');
                label.style.textShadow = distance < 1.5 ? '0 0 10px var(--red)' : (distance < 3.5 ? '0 0 10px var(--yellow)' : '0 0 10px var(--cyan)');
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
// 4. Camera & Live Streaming Manager
// -------------------------------------------------------------
class CameraManager {
    constructor() {
        this.video = document.getElementById('video-feed');
        this.canvas = document.getElementById('offscreen-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.stream = null;
        this.loopTimer = null;
        this.fpsTimestamp = 0;
        this.frameCount = 0;
    }

    async startCamera() {
        try {
            // 1. Request Camera/Microphone
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: true // Ensure microphone is requested
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            
            // 2. ADDED: Capture Location for Debugging
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        state.currentLat = position.coords.latitude;
                        state.currentLong = position.coords.longitude;
                        console.log("DEBUG: Location Acquired - Lat:", state.currentLat, "Lng:", state.currentLong);
                        speech.logToConsole(`GPS Locked: ${state.currentLat.toFixed(4)}, ${state.currentLong.toFixed(4)}`, 'system-msg');
                    },
                    (error) => {
                        console.error("GPS Error:", error);
                        speech.logToConsole(`GPS Error: ${error.message}`, 'hazard-msg');
                    },
                    { enableHighAccuracy: true }
                );
            }

            // 3. Start stream loop
            state.isScanning = true;
            this.runStreamingLoop();
            
            speech.speak("Camera and location services activated.");
            document.getElementById('btn-scan-toggle').innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
            document.getElementById('btn-scan-toggle').classList.add('btn-stop');
            document.querySelector('.app-header').classList.add('camera-active');
            
        } catch (e) {
            console.error("Camera feed failed:", e);
            speech.speak("Camera access was denied or unavailable.");
            speech.logToConsole("Camera Error: Check permissions.", "hazard-msg");
        }
    }

    stopCamera() {
        state.isScanning = false;
        
        if (this.loopTimer) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.video.srcObject = null;
        sonar.stop();
        sonar.setDistance(Infinity); // reset sonar distance

        speech.speak("Camera deactivated.");
        document.getElementById('btn-scan-toggle').innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        document.getElementById('btn-scan-toggle').classList.remove('btn-stop');
        document.querySelector('.app-header').classList.remove('camera-active');
    }

    toggleScanner() {
        if (state.isScanning) {
            this.stopCamera();
        } else {
            this.startCamera();
        }
    }

    runStreamingLoop() {
        if (!state.isScanning) return;

        // Draw video frame to hidden canvas
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            this.sendFrameToBackend();
        }

        // Calculate timeout interval based on target streaming FPS
        const loopInterval = 1000 / state.streamFps;
        this.loopTimer = setTimeout(() => this.runStreamingLoop(), loopInterval);
    }

    async sendFrameToBackend() {
        // Only attempt backend fetch if not in local slider-test override mode
        const testSliderVal = parseFloat(document.getElementById('range-test-distance').value);
        if (testSliderVal < 6.0) {
            return; // Slider testing overrides backend calls
        }

        try {
            // Compress canvas to JPEG Blob
            const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/jpeg', 0.65));
            
            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');
            formData.append('confidence', (state.confidence / 100).toFixed(2));

            const response = await fetch(`${state.backendUrl}/detect`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            // Expected response payload format:
            // { "status": "success", "detections": [{"class": "chair", "distance": 1.2}], "hazard_distance": 1.2 }
            if (data.status === 'success') {
                const distance = data.hazard_distance !== undefined ? parseFloat(data.hazard_distance) : Infinity;
                
                // Adjust audio sonar pacing
                sonar.setDistance(distance);

                // Voice TTS alerts for close obstacles
                if (data.detections && data.detections.length > 0) {
                    data.detections.forEach(det => {
                        if (det.distance < 2.0) {
                            speech.speak(`${det.class} ${det.distance.toFixed(1)} meters.`, false);
                            speech.logToConsole(`HAZARD DETECTED: ${det.class} at ${det.distance.toFixed(1)}m`, 'hazard-msg');
                        }
                    });
                }
            }

        } catch (e) {
            // Backend offline warning (throttled)
            if (this.frameCount === 0) {
                console.warn("Backend server connection failed:", e);
                speech.logToConsole("Backend offline. Simulation mode active. Adjust 'Sonar Hazard' slider to test.", "system-msg");
            }
        }
    }

}

const camera = new CameraManager();

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
            if (val >= 6.0) {
                this.lblTestDistance.textContent = 'Infinite';
                sonar.setDistance(Infinity);
            } else {
                this.lblTestDistance.textContent = `${val.toFixed(1)}m`;
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

// 1. Updated fetchNavigation function
function fetchNavigation(startLong, startLat, destination) {
    fetch('/get_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startLong: startLong,
            startLat: startLat,
            destination_text: destination
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            speech.logToConsole(`Error: ${data.error}`, 'hazard-msg');
            return;
        }
        
        // 1. Show the popup window with coordinates
        showRouteModal(data); 

        // 2. Load the app.py steps into the frontend NavigationManager
        // We have to map your app.py structure to what the UI expects
        navigation.steps = data.steps.map(step => ({
            maneuver: {
                instruction: step.instruction,
                location: step.location,
                type: 'turn' // Default fallback for the UI icons
            },
            distance: 0, // Fallback to prevent UI crash
            duration: 0
        }));
        
        navigation.currentStepIndex = 0;

        // 3. Announce the route has started out loud!
        const startText = `Route to ${data.destination_found} calculated. ${navigation.steps[0].maneuver.instruction}`;
        speech.speak(startText, true); // 'true' makes it a priority speech interruption
        
        // 4. Update the visual UI step card
        navigation.displayStep();
        
        // 5. Turn on Live GPS Tracking so it triggers the next steps as you walk
        navigation.startRealGPSWatch();
    })
    .catch(err => {
        console.error(err);
        speech.logToConsole(`Routing Network Error`, 'hazard-msg');
    });
}

// 2. Updated showRouteModal function
function showRouteModal(data) {
    const modal = document.getElementById('route-modal');
    const content = document.getElementById('modal-content');
    
    // Fix: Use state.currentLat and state.currentLong here!
    content.innerHTML = `
        <strong>Destination:</strong> ${data.destination_found}<br>
        <strong>Your Coordinates:</strong> ${state.currentLat.toFixed(5)}, ${state.currentLong.toFixed(5)}<br>
        <strong>Dest Coordinates:</strong> ${data.destLat.toFixed(5)}, ${data.destLong.toFixed(5)}
    `;
    
    modal.style.display = 'block';
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
        btn.classList.toggle('active', !state.sonarMuted);
        
        if (state.sonarMuted) {
            sonar.stop();
            speech.speak("Sonar ticks muted.");
        } else {
            speech.speak("Sonar ticks unmuted.");
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

    // Audio Test Button
    document.getElementById('btn-trigger-speech-test').addEventListener('click', (e) => {
        triggerHaptic(50);
        
        const btn = e.currentTarget;
        btn.classList.add('active'); // Turn Green (ON state)
        
        speech.speak("This is an audio announcement test. System is operational.", true);
        sonar.playBeep(440, 0.1);
        
        // Revert to Red (OFF state) after the test completes (~3.5 seconds)
        setTimeout(() => {
            btn.classList.remove('active');
        }, 3500);
    });

 // Speak Destination Button (UPGRADED with Camera Hand-off)
document.getElementById('btn-voice-dest').addEventListener('click', () => {
    triggerHaptic(50);
    
    // Ensure GPS is locked first
    if (!state.currentLat || !state.currentLong) {
        speech.speak("Please start the camera first to lock your GPS location.");
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        speech.logToConsole("Voice recognition not supported in this browser.", "hazard-msg");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    const btn = document.getElementById('btn-voice-dest');
    btn.innerHTML = '<i class="fa-solid fa-ear-listen"></i> Listening...';
    
    // Use a variable to store the stream temporarily
    let savedStream = null;

    recognition.onstart = () => {
        if (state.isScanning && camera.stream) {
            // 1. Physically nullify the video stream object
            savedStream = camera.stream;
            camera.stream.getTracks().forEach(track => track.stop());
            camera.video.srcObject = null;
            
            speech.logToConsole("Hardware released for mic...", "system-msg");
        }
    };

    recognition.onspeechend = () => {
        recognition.stop();
        
        // 2. Re-initialize the stream object exactly as you did in startCamera()
        if (savedStream) {
            const constraints = {
                video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
                audio: true
            };
            navigator.mediaDevices.getUserMedia(constraints).then(newStream => {
                camera.stream = newStream;
                camera.video.srcObject = newStream;
                savedStream = null;
            });
        }
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak Destination';
    };

    // Short beep to let you know it's ready
    sonar.playBeep(600, 0.1); 
    
    recognition.start();

    // 1. When it successfully hears a result
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.replace(/[.,]/g, '').trim();
        speech.logToConsole(`Heard: "${transcript}"`, "system-msg");
        
        // Reset button
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak Destination';
        
        // Fire the route request
        fetchNavigation(state.currentLong, state.currentLat, transcript);
    };

    // 2. When you stop speaking, tell the mic to cut off and resume camera[cite: 17]
    recognition.onspeechend = () => {
        recognition.stop();
        if (state.isScanning) {
            camera.video.play(); // Resume the camera feed[cite: 17]
        }
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak Destination';
    };

    // 3. If it fails or hears nothing, reset the UI and resume camera
    recognition.onerror = (event) => {
        console.warn("Speech API Error:", event.error);
        if (state.isScanning) {
            camera.video.play(); // Ensure camera resumes even on error[cite: 17]
        }
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak Destination';
        
        if (event.error === 'no-speech') {
            speech.logToConsole("Didn't catch that. Tap and try again.", "hazard-msg");
        } else {
            speech.logToConsole(`Mic error: ${event.error}`, "hazard-msg");
        }
    };
});
// Clear Logs logic removed by request
}

// Custom Pull-to-Refresh Logic
function initPullToRefresh() {
    let touchStartY = 0;
    let touchMoveY = 0;
    const ptrIndicator = document.getElementById('ptr-indicator');
    if (!ptrIndicator) return;

    document.addEventListener('touchstart', (e) => {
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
