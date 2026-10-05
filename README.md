# Limitless — Gojo Hand Tracker

Webcam hand tracking that casts Gojo Satoru's techniques from *Jujutsu Kaisen*, all in the browser.
It uses MediaPipe Hand Landmarker for tracking and a Canvas 2D particle engine for the effects.

| Gesture | Technique |
|---|---|
| ☝️ Index finger up, other fingers curled | **Blue**: a gravity orb that pulls particles in and warps the image around it |
| ✌️ Peace sign, fingers spread | **Red**: a repulsion orb that throws sparks, red lightning and shockwaves |
| 🙌 Blue on one hand + Red on the other, brought together | **Hollow Purple** charges. Open a palm or pull your hands apart to fire the beam |
| 🤞 Index + middle crossed, held for about half a second | **Domain Expansion: Infinite Void**. Make a fist to end it |

Keyboard fallback (no camera needed): hold `B` / `R` (hold both for Purple, `Space` fires), `D` toggles the domain, `H` shows the hand skeleton, `Tab` hides the panel.

## Run

The camera only works over `http://localhost` or HTTPS, so serve the folder rather than opening the file directly:

```sh
python -m http.server 8000
# open http://localhost:8000
```

Video stays on your device. Nothing is uploaded.
