# NavVision - Helping Visually Impaired Individuals Navigate Confidently and Independently

A web application using LiDAR, Mapbox Open Source map API, Swift UI, JavaScript, CSS, and HTML to help visually impaired individuals navigate new and known experiences with confidence independently.

We use the LiDAR sensor on a phone (most likely an iPhone) for object detection, which will send a signal that produces an audible noise instantaneously that increases in repetition the closer one gets to the object. Mapbox turns map coordinates from their source into text and then grabs the user's coordinates and calculates a walkable route to the destination coordinates.

Features:
* Object detection and Proximity alerts using LiDAR. These alerts are instantaneous, detect objects with a minimum distance of 1.5m from the user, and can be increased in sensitivity to allow earlier detection. These alerts, paired with phone vibrations, increase in repetition and frequency the closer the user or an object gets to each other.
* Clean UI that is screen reader accessible. (For demonstration purposes, the buttons were made a bit smaller but are intended to be larger and brighter, with bolder colors for individuals who may not be fully blind).
* Instantaneous location retrieval for turn-by-turn maps navigation and emergency scenarios.
* Live and responsive voice control to ask for building locations.

The most available and stable versions are in the `nav2` branch specifically for Android devices and in the `cv` branch for iPhones. Either branch will run, but the proximity sensing only works on iPhones with LiDAR in the `cv` branch. 

To run, you need: 
* ngrok
* terminal or some sort of IDE to run command-line prompts
* Mobile Device (iPhone to use the LiDAR proximity detection feature of the app, or you can use mobile or web aswell but with simulated proximity alerts)

Our UI looks different on mobile compared to using a desktop.

Setting up:

1. Once you have ngrok installed and have cloned our repository and moved into the right directory, run `python app.py`
so the local Flask server starts on your computer (in the terminal).
3. Create a separate terminal (in VS Code or an IDE/command prompt) in the same directory and run `ngrok http 5000` (this number might vary).
4. Once running, you will see your ngrok server started up and a 'Forwarding Link' to follow. Either copy and paste it into a browser or click the link.
5. Click 'View Site'
6. Once you see our UI, click the 'Settings' button > replace `https://localhost:5000` or whatever is there with the same Forwarding Link that is in your address bar (just copy and paste the URL to replace the localhost link).
7. Click the drop-down that currently has "Simulated Route" selected and change it to "Real Device GPS (requires HTTPS)". This only has to be done once initially unless you stop the ngrok or Flask server in your terminal, not if you refresh the page.
8. From there, save your settings, click the 'X' and refresh the page.
9. Allow Microphone, Location, and Camera permissions.
10. Allow the Voice-to-Text to finish instructing you to allow camera permissions, then click 'Speak Destination'. Only destinations currently are specific to the UCF campus, such as: Library, Student Union, Classroom building 2, RWC, Towers, Apollo Dorms, and L3 Harris
11. The words that the user speaks will appear below (for demonstration purposes, as our user base will primarily and only utilize screen readers, voice, and audio responses).
12. A pop-up will appear with an audible confirmation telling you your location was grabbed, instantly followed by turn-by-turn directions audibly with instantaneous object detection.
13. After that you're ready to go :)
