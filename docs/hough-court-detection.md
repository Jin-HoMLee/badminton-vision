# Hough Line Transform for Automatic Court Line Detection

This module provides classical computer vision-based automatic court line detection using the Hough Line Transform. It is a fast, no-ML alternative to neural network-based approaches.

## Overview

The Hough Line Transform is a classical computer vision technique that votes for lines in an image through edge pixel accumulation. This implementation uses a complete pipeline:

1. **Grayscale conversion** - Convert RGBA to grayscale
2. **Histogram equalization** - Normalize lighting variations
3. **Gaussian blur** - Reduce noise while preserving edges
4. **Canny edge detection** - Sobel derivatives, non-maximum suppression, hysteresis
5. **Hough line transform** - Accumulate votes in (rho, theta) space
6. **Peak merging** - Collapse duplicate parameterizations and double ridges of one thick line
7. **Support clipping** - Trim each segment to the edge pixels that actually support it
8. **Length filter + output cap** - Drop weak tails, return the strongest lines

## Implementation

Located in `src/extension/offscreen/hough-court-lines-adapter.js`.

### Core API

```javascript
// Detect court lines from a video frame
const result = await BSOHoughCourtLinesAdapter.detectCourtLines(frame, config);

// Returns:
{
  lines: [
    { x1, y1, x2, y2, angle, votes },  // normalized [0,1]
    // ... up to maxLines lines
  ],
  config: { /* merged config used */ }
}
```

`frame` is `{ width, height, data }` with RGBA pixel data (a plain array or
`Uint8ClampedArray`). In the extension the content script sends a bounded
640px-long-edge capture; the adapter also accepts drawable sources when an
`OffscreenCanvas`/`document` environment is available.

### Configuration

```javascript
{
  cannyLow: null,           // null = adaptive per frame (recommended)
  cannyHigh: null,          // null = adaptive per frame (recommended)
  rhoResolution: 1,         // Accumulator bin size (pixels)
  thetaResolution: 1,       // Accumulator bin size (degrees)
  votingThreshold: 45,      // Minimum accumulator votes to accept a peak
  minLineLength: 0.05,      // Minimum segment length (normalized to image diagonal)
  minSupportSpan: 0.05,     // Minimum edge support span (normalized to image diagonal)
  angleGroupTolerance: 6,   // Degrees - merge peaks within this angle...
  distanceGroupTolerance: 24, // Pixels - ...and this rho distance
  maxLines: 12              // Output cap, strongest first
}
```

### Adaptive Canny thresholds

Real broadcast frames previously produced **zero** edges with fixed
`cannyLow: 50, cannyHigh: 150`: after the Gaussian blur and the Sobel `/8`
magnitude scaling, achievable NMS magnitudes top out near ~60, so the `high`
threshold could never be reached and hysteresis had no strong seeds. The
defaults are therefore adaptive and derived from each frame's own NMS
magnitude distribution: `high` is the 97th percentile of ridge magnitudes
(floor 3) and `low = high * 0.5` (floor 2). Explicit numeric thresholds are
still honored when provided.

### Segment support

Segments are clipped to the span of edge pixels lying within 2px of the
detected line, so guidance strokes hug the visible line markings instead of
being extended across the whole frame. Peaks whose support span or pixel
count stay below `minSupportSpan` are dropped.

### Performance

At the bounded 640px capture used by the content script the full pipeline
runs in roughly 60-160ms per frame on a 2020-era laptop. The largest cost is
the Hough vote loop over edge pixels (180 theta bins each); the merge step is
bounded by considering only the top 120 peaks.

Calibration never runs this cost continuously. Court calibration is a
one-shot burst flow (see below): each recalibration event runs ONE burst of
4 temporally spaced passes (~60-160ms each, spaced by the response chain plus
300ms), aggregates the results, and then stops - zero steady-state CPU
between bursts. If a full-resolution pass were ever needed, downscaling the
guidance frame ~0.5x cuts the cost ~4x while line geometry survives; the
content script already captures at a bounded 640px long edge.

## Usage in Calibration Flow

1. Court seeding is active (initial setup, a corner mutation that invalidates
   the fit, a camera-cut re-seed, or a restored in-progress setup after a
   page reload). The content script runs ONE short burst of temporally
   spaced detection passes (default 4, chained on each pass's response so the
   offscreen document never queues two detections), then stops by itself -
   nothing polls while the user thinks between corner clicks. The court is
   static per camera scene (research report section 5.1), so the aggregated
   guidance stays valid until the next invalidation. The burst policy and the
   consensus math live in `src/hough-guidance.js` (`BVHoughGuidance`), loaded
   into the content bundle before `src/content.js`; the cadence is read from
   `CONFIG` at burst time.
2. Each pass captures the current frame at max 640px long edge and sends it
   to the service worker, which relays it to the offscreen document
3. The offscreen document runs the Hough pipeline (see above) per frame
4. Each pass with lines refreshes the guidance immediately; when the burst
   finishes, its passes are merged into a consensus set (lines confirmed on
   at least `minPasses` distinct passes, near-duplicates merged by angle and
   line distance) that replaces the per-pass strokes. Empty passes keep the
   last known scene lines so a momentarily occluded frame never blanks the
   guidance
5. The guidance strokes render on the overlay's `.bv-hough-canvas` as light
   blue guidance lines over the video while seeding stays active
6. The next burst fires only on a recalibration event: seeding start (or an
   explicit re-setup of an already calibrated court), a corner place/undo/
   reset, or a camera cut - a camera cut first clears the old scene's lines
   (stop) and then starts a fresh burst for the new angle. When seeding ends
   (lock or cancel), the burst is stopped and the guidance canvas is cleared
   so stale strokes cannot linger; the render path is a stop-only safety net

## Testing with Real Videos

Target accuracy: ≥70% detection of 3-4 main court lines without false positives.
Validated end to end on a real broadcast match (Paris 2024 men's singles
final, 720p stream): during play the detector returns 3-12 stable lines per
frame that track the court's visible boundary, service, and centre lines;
close-ups return fewer or no lines rather than hallucinated courts.

Test scenarios:
- Varied court types (wood, synthetic, clay)
- Different lighting (bright, shadows, indoor, outdoor)
- Multiple camera angles
- Different court conditions (worn, clean, new lines)

## Parameter Tuning

The adaptive defaults cover typical broadcast lighting without tuning.
Explicit overrides that have proven useful for specific conditions:

### Bright outdoor courts (explicit override)
```javascript
{
  cannyLow: 8,    // lower thresholds for high-contrast courts
  cannyHigh: 20,
  votingThreshold: 30
}
```

### Indoor/shadowed courts (explicit override)
```javascript
{
  cannyLow: 12,
  cannyHigh: 28,
  votingThreshold: 40
}
```

These literals live on the same 0..255 NMS magnitude scale as the adaptive
values (blurred, `/8`-scaled Sobel), not on OpenCV's raw gradient scale.

## Algorithm Details

### Hough Line Transform

For each edge pixel at (x, y) and for each angle θ ∈ [0°, 180°):
- Compute ρ = x·cos(θ) + y·sin(θ)
- Increment accumulator[θ][ρ]
- Extract peaks (ρ, θ) where accumulator exceeds votingThreshold

### Peak merging

Near-vertical lines appear twice in the accumulator — around θ ≈ 0 with
ρ ≈ +c and around θ ≈ 179 with ρ ≈ −c — and the smeared votes any line
leaves on neighbouring θ bins can straddle either side of any fixed fold
threshold, so no blanket angle fold is applied. Each peak is matched
against a group reference in its own (θ, ρ) parameterization first and,
when that matches no group, against the folded twin (180 − θ, −ρ) — but
only for item/reference pairs that straddle the 0/180 seam (one θ within
`angleGroupTolerance` of 0 and the other within `angleGroupTolerance` of
180). Without that seam gate the folded comparison would also absorb
genuinely distinct level lines: θ ≈ 90 is its own complement under
(180 − θ), so two level rows mirror-symmetric about the frame centre
have anti-matching offsets and would collapse into one group no matter
how far apart they lie. With the gate the wrap-seam duplicates collapse
while the smears of a single stroke merge back into their true peak
through the native comparison. The
perpendicular distance used for merging is measured from the frame centre
along the line normal — not from the corner origin ρ measures — because
ρ itself grows with distance from the origin, and an origin-anchored
window splits the off-angle smears of long lines off their head. Peaks
within `angleGroupTolerance` degrees AND `distanceGroupTolerance` pixels
of that distance describe one physical line (a thick painted line
produces several adjacent edge rows ~1 line-width apart); the strongest
vote of each group survives. Distinct parallel court lines differ by more
than the distance tolerance and survive independently.

### Support clipping and endpoints

For every surviving peak the edge map is scanned for pixels within 2px of the
line. The projection of those pixels along the line direction bounds the
segment (`minS..maxS`), which is then converted back to image coordinates and
trimmed to the frame rectangle.

## Apache 2.0 License

This implementation is original, non-derived work subject to the same license as the repository.
