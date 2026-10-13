# iLoveImages Forge

Crop and edit one image, and watch it update live on many screen sizes at once. Everything runs in the browser: there's no backend, and images never leave your device.

- **Editor:** a crop box you can drag, with aspect-ratio lock (free, original, 1:1, 4:5, 4:3, 3:2, 16:9, 9:16), rotate, flip, and a straighten slider that zooms in automatically to hide empty corners
- **Adjust:** brightness, contrast, saturation, hue, mono, sepia, blur and vignette, plus one-click looks
- **Output:** JPEG, WebP or PNG (AVIF where the browser supports it), set by quality or by a max file size. Fit modes: fill, fit, pad, stretch
- **Live viewports:** desktop, laptop, tablet, phone, social and custom sizes, each in a device frame. They redraw instantly while you edit. Once you pause, each one is encoded at full resolution, showing the real file size and how much smaller it is than the original
- Download each size, or all of them as a `.zip`. Click any screen to inspect it full size.

## Pages & SEO

The HTML pages are generated from one template, so every landing page shares the app but has its own title, description, canonical URL, H1, structured data (JSON-LD), guide content and starting settings.

| Page | Starting setup |
|---|---|
| `/` | Image resizer, cropper & compressor |
| `/resize-image-for-instagram/` | Instagram post, portrait and story sizes |
| `/resize-image-for-youtube-thumbnail/` | 16:9 crop, 1280×720, under 2 MB |
| `/compress-image-to-100kb/` | Target size 100 KB |
| `/compress-image-to-50kb/` | Target size 50 KB |
| `/crop-image/` | Crop tools |
| `/convert-image-to-webp/` | WebP output |
| `/responsive-image-generator/` | Desktop, laptop, tablet and mobile breakpoints |

**Edit `src/template.html` (markup) or `scripts/build.mjs` (page copy, metadata), then regenerate:**

```sh
node scripts/build.mjs   # writes index.html, */index.html, 404.html and sitemap.xml
```

Don't hand-edit the generated HTML files. `app.js` and `styles.css` are shared and edited directly.

Also included: `robots.txt`, `sitemap.xml`, `site.webmanifest`, icons, a 1200×630 `og-image.png` for social previews, and a `noindex` 404 page.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It's a static site, so it can be deployed as-is to GitHub Pages, Netlify, Vercel, etc.
