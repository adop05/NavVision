# Data Collector App — Setup Notes

## Adding to an Xcode project

1. Create a new iOS App project in Xcode (SwiftUI interface, Swift language).
2. Drag all 5 .swift files into the project (DataCollectorApp.swift replaces
   the default `<ProjectName>App.swift` — delete the auto-generated one, or
   just remove its `@main` attribute).
3. Add required Info.plist keys (Xcode 15+ project settings > Info tab, or
   directly in Info.plist):

   - `NSCameraUsageDescription`
     "This app uses the camera to record footage for training an obstacle
     detection model."

   ARKit itself doesn't require a separate usage string beyond camera access,
   but make sure your deployment target and device support ARKit + LiDAR
   (iPhone 12 Pro or later for sceneDepth).

4. Under Signing & Capabilities, no special capability is needed for ARKit
   or local file storage. If you later add "Save to Photos" instead of/in
   addition to the Files share sheet, you'll also need:

   - `NSPhotoLibraryAddUsageDescription`
     "Save recorded obstacle footage to your photo library."

5. Set minimum deployment target to iOS 16+ (SwiftUI APIs used here are
   broadly compatible with 15+, but 16+ is safer given `.sheet(item:)` and
   NavigationView patterns — adjust if you need to support older devices).

## Why recording goes through ARSession instead of the stock Camera app

Your production detection pipeline (ARDepthDetectionManager from earlier)
reads frames from `ARFrame.capturedImage` under an
`ARWorldTrackingConfiguration`. That image differs from a normal
AVCaptureSession/Camera-app photo in resolution, field of view, and lens
distortion correction. If your training data comes from a different capture
path than your inference data, you introduce a train/inference domain gap
that can quietly hurt YOLO's accuracy in the field — most visibly as edge
cases where objects are foreshortened, cropped, or scaled differently than
what the model saw during training.

Recording through the same ARSession configuration (as this app does)
means your training footage is pixel-for-pixel representative of what the
model will actually receive at inference time.

## Suggested collection workflow

1. Wear the app on the same chest-lanyard mount you'll use for the final
   product, at the same height/angle.
2. Record real walks in the environments/conditions you expect the app to
   be used in (different obstacle classes, lighting, weather if relevant).
3. Use the record button on ContentView; tracking status badge at the top
   will tell you if ARKit is having trouble (e.g. "Limited: low
   texture/light") — worth avoiding recording in those conditions since your
   production pipeline will have the same issue.
4. Open the Recordings list (list icon, top right) after each session,
   export via the share icon (AirDrop/Files/Save to Photos) to get clips
   onto your annotation machine for CVAT.
5. Delete clips from the device after export to free up storage — videos
   are stored uncompressed-ish (H.264 at 12 Mbps) so multi-minute clips add
   up quickly.

## Known limitations / things to test

- No pause/resume mid-clip — stopping and starting creates separate files.
  Fine for training data (arguably better — natural segment boundaries).
- No on-screen exposure/focus lock — if outdoor lighting conditions vary a
  lot between recording sessions, consider whether that variability helps
  (robustness) or hurts (inconsistent labels) your dataset, and decide
  intentionally rather than by accident.
- Video resolution is hardcoded to 1920x1440 in ARFrameRecorder — verify
  this actually matches `ARWorldTrackingConfiguration.supportedVideoFormats`
  on your specific iPhone 15 Pro before recording a large dataset, since a
  mismatch there would negate the whole point of recording through ARKit.
