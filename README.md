# iLoveImages

Resize and compress one image into many sizes at once, with a live preview of each. Everything runs in the browser, so images are never uploaded anywhere.

- **Format:** JPEG, WebP, PNG, plus AVIF in browsers that can encode it
- **Compression:** set a quality, or set a max file size and the app searches for the best quality that fits (it can also shrink the dimensions if needed)
- **Fit modes:** fill/crop, fit inside, pad, stretch; never-upscale option
- **Sizes:** desktop, laptop, tablet and mobile viewports, social sizes, web sizes, plus your own custom sizes
- Download each size on its own, or all of them as a `.zip`

## Run locally

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

It can be deployed as-is to GitHub Pages, Netlify, Vercel, etc.
