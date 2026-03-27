# personal-website

You need a local HTTP server so `fetch()` can load the HTML fragments and modules resolve correctly (opening `index.html` as a file URL will not work).

From this folder:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).
