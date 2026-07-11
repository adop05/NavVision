# NavVision - Spatial Awareness & Navigation Assistant

NavVision is a hands-free, ears-free navigation and spatial awareness web application designed for the visually impaired. It runs in mobile browsers, accessing the device's rear camera to scan for hazards and GPS coordinates to deliver active walking routes.

This repository holds the **Frontend UI & Hardware Bridge** component.

---

## 🚀 Key Features

- **Spatial Sonar Ticking**: Uses the browser's native **Web Audio API** to generate real-time synthesized audio "ticks" that speed up and increase in pitch as hazards get closer (simulating an active parking/backing sensor).
- **Tactical Navigation & TTS**: Integrates **Mapbox GL JS** and **Mapbox Directions API** to get walking directions. It tracks location (via GPS or built-in Route Simulator) and reads instructions aloud using the **Web Speech API (Text-to-Speech)**.
- **Continuous AI Inference Loop**: Continuously captures camera frames from a hidden canvas and streams them via `POST` requests to the Flask YOLOv8 backend.
- **Instant Scene Description**: Register double-taps on the main scanner screen (or click the button) to trigger a deep, generative vision scene analysis from the AI backend.
- **Configurable Developer Dashboard**: Easily change the Mapbox token, target coordinates, simulation mode, and backend URL on the fly without hardcoding values.
- **Edge-to-Edge OLED UI**: Features a meticulously designed, zero-gap mobile layout (optimized for tall aspect ratios like the Samsung Galaxy S25 Ultra) heavily utilizing true blacks (`#080808`) for battery saving and high-contrast, low-smear usability.

---

## 🛠️ Developer Setup & Local Run

To access the device camera and Geolocation APIs in a browser, modern mobile operating systems **require an HTTPS connection**. To test locally on your phone, you must serve the files locally and tunnel them using NGROK.

### Step 1: Start a Local Web Server
You can serve these static files using Python's built-in module:
```bash
python3 -m http.server 8000
```
This serves the application on `http://localhost:8000`.

### Step 2: Open an NGROK HTTPS Tunnel
If you have ngrok installed, open a secure HTTPS tunnel to your web server port:
```bash
ngrok http 8000
```
Ngrok will generate a secure forwarding URL like:
`https://a1b2-c3d4.ngrok-free.app`

### Step 3: Test on a Mobile Device
1. Open the **ngrok HTTPS URL** in your mobile web browser (Safari or Chrome).
2. Allow camera and location permissions when prompted.
3. Click **Start Scanner** to initialize the rear camera stream.

---

## ⚙️ Configuration & Testing

1. **Mapbox Setup**: Open the **Settings** panel (sliders icon) in the footer, paste your Mapbox Access Token, and hit save.
2. **Local Sonar Testing**: You can test the audio ticking system entirely offline without the Flask server! Move the **Simulated Hazard Distance** slider to a value less than `6.0m` (e.g. `1.5m`) to manually trigger the audio ping rates.
3. **Simulated Route Testing**: Change the GPS location mode in settings to **Simulated Route**, enter start/destination coordinates, and click **Load simulated route**. The app will simulate walking the path and voice directions to you.
4. **Connecting the AI Backend**: Set the **Flask Backend Base URL** in settings to your backend Flask server's ngrok tunnel URL (e.g., `https://flask-backend.ngrok-free.app`). Frames will automatically stream to the backend's `/detect` endpoint.
