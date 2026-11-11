# JSON Compare

A lightweight, frontend-only JSON comparison tool. Native textareas, TypeScript, plain CSS, and **zero runtime dependencies**. No fonts, analytics, CDN assets, accounts, or server API calls. JSON stays in the browser.

## Run locally

Use Node.js 24+ and npm:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. On PowerShell systems that block `npm.ps1`, use `npm.cmd` in place of `npm`.

```sh
npm test
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTP rather than opening `index.html` as a local file.

## Usage

1. Type, paste, select a file, or drop one file into each input panel. Use **Load example** to load sample documents.
2. **Format** validates and indents the selected input. **Compare JSON** validates both inputs and renders separate read-only results without changing the original text.
3. Changed lines and their line numbers are red and include a dot marker. Numeric values on affected lines receive additional highlighting. Use the difference list or Previous/Next to navigate.
4. Edits mark existing results as outdated. Compare again to refresh them.

Empty inputs and invalid JSON show inline errors. File selection and dropping also validate immediately. Errors clear when an invalid input is corrected. Syntax error locations are shown when the browser parser provides them.

## Comparison rules

- Whitespace and object-key order are ignored by default. Enable **Compare object key order** to retain and compare key order.
- Arrays are compared by index; insertions may therefore produce several differences. Array order matters.
- A changed value or type counts once. An added or removed property, array item, or entire subtree counts once. A key-order change counts once per affected object, alongside any value changes.
- Paths use JSON Pointer notation (`/settings/retries`); `~` and `/` in keys are escaped as `~0` and `~1`. Line references refer to the formatted results, not the input text. Missing sides are explicitly labeled.
- JSON is parsed using native `JSON.parse`: duplicate keys use their last value, numeric object keys follow JavaScript enumeration rules, and numbers use IEEE 754 precision. Integers outside the safe integer range can lose precision; encode exact large identifiers as strings. Non-finite parsed numbers are rejected during formatting/comparison.
- Files are limited to 1 MB; input strings to 1,000,000 UTF-16 code units. Documents must fit within 150 nesting levels and 30,000 formatted lines per side. These limits bound browser resource use; very large comparisons can still take longer on slower devices.

## Local storage

Both input texts and the key-order preference are saved after 350 ms of inactivity under `json-compare:v1`. The current inputs restore on reload; click Compare to regenerate results. Files themselves are not stored, only their loaded text. There is no comparison history.

**Clear saved data** removes the persisted copy while retaining current inputs. Autosave resumes on the next edit. To remove the content from both the screen and storage, clear both inputs and then clear saved data.

Storage is per origin, so apps on the same GitHub Pages hostname share an origin. Private browsing, disabled storage, storage quotas, or third-party iframe restrictions may prevent saving. A status message reports this; editing and comparison continue to work. Anyone with access to the same browser profile may access locally saved content.

## GitHub Pages

1. Create a GitHub repository, commit these files including `package-lock.json`, and push to `main`.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` runs tests and a production build, then deploys `dist/`. It also supports manual runs from the Actions tab.
4. Use the deployment URL reported by the workflow, typically `https://OWNER.github.io/REPOSITORY/`.

Relative asset URLs support both project and root Pages sites. No server, environment secrets, or SPA routing fallback is required. If using a branch other than `main`, update the workflow trigger. Deployment requires an actual repository and Pages configuration; creating the files does not publish the site.

## Embed

```html
<iframe
  src="https://OWNER.github.io/REPOSITORY/?embed=1"
  title="JSON comparison tool"
  width="100%"
  height="950"
  style="border: 0; border-radius: 12px;"
  loading="lazy"
></iframe>
```

`?embed=1` hides the page title and uses a compact layout. The frame scrolls for results beyond its height. If the parent site uses CSP, allow the Pages origin in `frame-src`. If sandboxing the frame, scripts are required for comparison; origin storage additionally requires `allow-same-origin` and may still be blocked by browser privacy settings. No parent-frame messaging is required or used.

## Verification

`npm test` covers semantic comparison, counts, formatted line ranges, ordering, primitives, invalid JSON, unusual keys, and resource limits. `npm run build` performs strict TypeScript checking and generates the static assets.

After building, `npm run test:browser` runs a dependency-free headless Chrome smoke test against the production assets, including a simulated GitHub Pages subdirectory and an iframe. It checks upload/drop, validation recovery, navigation, numeric highlights, scrolling, autosave/restore, blocked storage, safe text rendering, keyboard access, and narrow layouts. Desktop and mobile screenshots are saved in the ignored `.verification/` directory. It uses the standard Windows Chrome path by default; set `CHROME_PATH` or run `node tests/browser.mjs /absolute/path/to/chromium` on other systems.

For a manual browser check: try the sample, change numeric values, navigate differences, enter invalid JSON in both panels, format and clear inputs, upload/drop valid and invalid files, reload after an edit, clear saved data, test blocked storage, and open `?embed=1` in an iframe. Check keyboard focus and a narrow viewport as well.
