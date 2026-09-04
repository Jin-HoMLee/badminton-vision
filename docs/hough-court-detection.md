# Hough Line Transform for Automatic Court Line Detection

This module provides classical computer vision-based automatic court line detection using the Hough Line Transform. It is a fast, no-ML alternative to neural network-based approaches.

## Overview

The Hough Line Transform is a classical computer vision technique that votes for lines in an image through edge pixel accumulation. This implementation uses a complete pipeline:

1. **Grayscale conversion** - Convert RGBA to grayscale
2. **Histogram equalization** - Normalize lighting variations (optional)
3. **Gaussian blur** - Reduce noise while preserving edges
4. **Canny edge detection** - Find image boundaries using Sobel derivatives
5. **Hough line transform** - Accumulate votes in (rho, theta) space
6. **Post-processing** - Filter by line length, group parallel lines

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
    // ... more lines
  ],
  config: { /* used config */ }
}
```

### Configuration

```javascript
{
  cannyLow: 50,           // Low threshold for Canny edge detection
  cannyHigh: 150,         // High threshold for Canny edge detection
  rhoResolution: 1,       // Accumulator bin size (pixels)
  thetaResolution: 1,     // Accumulator bin size (degrees)
  votingThreshold: 50,    // Minimum votes to accept a line
  minLineLength: 0.1,     // Minimum line length (normalized [0,1])
  angleGroupTolerance: 5, // Degrees - group parallel lines
  distanceGroupTolerance: 20 // Pixels - distance grouping
}
```

## Performance

- **Speed**: 5-15ms per frame (depending on image size and feature density)
- **Memory**: Minimal (edge map + accumulator array)
- **No training data required** - pure algorithm, Apache 2.0 licensed

## Usage in Calibration Flow

1. User enters calibration mode and captures a video frame
2. System runs Hough transform in background
3. If ≥3 lines detected with high confidence:
   - Show detected lines as overlay guidance
   - Allow user to approve auto-detection
   - Optionally auto-populate corner points
4. Fallback: Always allow manual 4-corner setup

## Testing with Real Videos

Target accuracy: ≥70% detection of 3-4 main court lines without false positives.

Test scenarios:
- Varied court types (wood, synthetic, clay)
- Different lighting (bright, shadows, indoor, outdoor)
- Multiple camera angles
- Different court conditions (worn, clean, new lines)

## Parameter Tuning

For best results on specific court conditions:

### Bright outdoor courts
```javascript
{
  cannyLow: 40,    // Lower threshold for high-contrast courts
  cannyHigh: 120,
  votingThreshold: 30  // More lines visible
}
```

### Indoor/shadowed courts
```javascript
{
  cannyLow: 60,    // Higher threshold to filter shadows
  cannyHigh: 180,
  votingThreshold: 50  // Stricter line requirement
}
```

### Worn courts (faint lines)
```javascript
{
  cannyLow: 30,    // Lower thresholds for faint edges
  cannyHigh: 100,
  votingThreshold: 20
}
```

## Algorithm Details

### Hough Line Transform

For each edge pixel at (x, y) and for each angle θ ∈ [0°, 180°):
- Compute ρ = x·cos(θ) + y·sin(θ)
- Increment accumulator[θ][ρ]
- Extract peaks (ρ, θ) where accumulator exceeds votingThreshold

### Line Extraction

Found lines are converted back to image space by finding intersections with image boundaries:
- Intersection with top edge (y=0)
- Intersection with bottom edge (y=height)
- Intersection with left edge (x=0)
- Intersection with right edge (x=width)

The two most distant intersection points define the line segment.

## Integration with Existing Calibration

The offscreen document loads the adapter and can invoke it during the calibration sequence:
```javascript
if (globalThis.BSOHoughCourtLinesAdapter) {
  const result = await BSOHoughCourtLinesAdapter.detectCourtLines(frame);
  if (result.lines.length >= 3) {
    // Suggest auto-detected lines to user
  }
}
```

## Fallback Strategy

If Hough detection produces <3 confident lines:
1. Show manual 4-corner setup as before
2. User manually clicks corners on the video
3. No disruption to existing workflow

## Apache 2.0 License

This implementation is original, non-derived work subject to the same license as the repository.
