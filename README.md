# iLoveImages Forge

Crop and edit one image, and watch it update live on many screen sizes at once. Everything runs in the browser: there's no backend, and images never leave your device.

- **Editor:** a crop box you can drag, with aspect-ratio lock (free, original, 1:1, 4:5, 4:3, 3:2, 16:9, 9:16), rotate, flip, and a straighten slider that zooms in automatically to hide empty corners
- **Adjust:** brightness, contrast, saturation, hue, mono, sepia, blur and vignette, plus one-click looks
- **Output:** JPEG, WebP or PNG (AVIF where the browser supports it), set by quality or by a max file size. Fit modes: fill, fit, pad, stretch
- **Live viewports:** desktop, laptop, tablet, phone, social and custom sizes, each in a device frame. They redraw instantly while you edit. Once you pause, each one is encoded at full resolution, showing the real file size and how much smaller it is than the original
- Download each size, or all of them as a `.zip`. Click any screen to inspect it full size.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It's a static site, so it can be deployed as-is to GitHub Pages, Netlify, Vercel, etc.
