from flask import Flask, request, jsonify, render_template
from flask_cors import CORS # You must import this
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app) # You must initialize this to allow your UI to talk to the backend

# 1. Configuration (Only pulls from .env securely now)
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN")

## campus locations hardcoded
CAMPUS_LANDMARKS = { 
    "student union": (-81.2007396, 28.6014148),
    "library": (-81.2019007, 28.6005131),
    "classroom building 2": (-81.2004441, 28.6038146),
    "cb2": (-81.2004441, 28.6038146),
    "rwc": (-81.2042876, 28.5960055),
    "apollo dorms": (-81.2013716, 28.5974666),
    "towers": (-81.2010075, 28.6080441),
    "l3 harris": (-81.199512, 28.5990831)
}

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/get_route', methods=['POST'])
def get_route():
    
    data = request.json
    startLong = data.get('startLong')
    startLat = data.get('startLat')

    # format the text (removing extra spaces and making all lowercase)
    spoken_text = data.get('destination_text', '').lower().strip()

    if not all([startLong, startLat, spoken_text]):
        return jsonify({"error": "Missing starting or destination text"}), 400
    
    try: 
        if spoken_text in CAMPUS_LANDMARKS:
            destLong, destLat = CAMPUS_LANDMARKS[spoken_text]
            found_place_name = spoken_text.title()

        else: 
            geocode_url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{spoken_text}.json"
            geo_params = {
                "access_token": MAPBOX_TOKEN,
                "proximity": f"{startLong},{startLat}",
                "limit": 1
            }
            geo_response = requests.get(geocode_url, params=geo_params)
            geo_data = geo_response.json()

            if not geo_data.get("features"): 
                return jsonify({"error": f"Could not find a location matching: {spoken_text}"}), 400
            
            destLong, destLat = geo_data["features"][0]["center"]
            found_place_name = geo_data["features"][0]["place_name"]

        # routing:
        coordinates = f"{startLong},{startLat};{destLong},{destLat}"
        mapbox_url = f"https://api.mapbox.com/directions/v5/mapbox/walking/{coordinates}"
        route_params = {
            "steps": "true",
            "geometries": "geojson",
            "access_token": MAPBOX_TOKEN
        }
        response = requests.get(mapbox_url, params=route_params)
        route_data = response.json()

        if response.status_code != 200 or "routes" not in route_data or not route_data["routes"]:
            return jsonify({"error": "No walkable route found"}), 400
        
        legs = route_data["routes"][0]["legs"]
        
        # Create a structured list of steps with coordinates
        route_steps = []
        for leg in legs:
            for step in leg["steps"]:
                route_steps.append({
                    "instruction": step["maneuver"]["instruction"],
                    "location": step["maneuver"]["location"] 
                })
        
        # Send ONLY the array of steps and coordinates back to the UI
        return jsonify({
            "steps": route_steps, 
            "destination_found": found_place_name,
            "destLong": destLong, 
            "destLat": destLat
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    # NEW: Add this dummy route so your JS stops throwing 404 errors
@app.route('/detect', methods=['POST'])
def detect_objects():
    # Placeholder for your CV team's future logic
    print("Frontend sent a frame for processing!") 
    return jsonify({"status": "success", "hazard_distance": 6.0, "detections": []})
    
if __name__ == '__main__':
    app.run(debug=True, port=5000)