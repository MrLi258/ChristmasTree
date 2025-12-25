# Christmas Tree Webpage

This is a dynamic 3D webpage featuring a Christmas tree with a specific camera animation sequence.

## How to Run

Because this project uses ES Modules (for Three.js), you cannot simply double-click `index.html` to open it in some browsers (like Chrome) due to security restrictions (CORS). You need to serve it via a local web server.

### Using Python (Recommended)

Since you have Python installed, you can easily start a server:

1.  Open a terminal/command prompt.
2.  Navigate to this folder:
    ```bash
    cd d:\python\pythonProjections\graduateStudentAssignment\ChristmasTree\webpage
    ```
3.  Run the following command:
    ```bash
    python -m http.server
    ```
4.  Open your browser and go to: `http://localhost:8000`

## Troubleshooting

### 1) Browser shows "WebGL not available" (or WebGL context cannot be created)

This means your current browser environment has WebGL disabled. Three.js requires WebGL to render.

Try the following in Microsoft Edge (Windows):

1. **Enable hardware acceleration**
    - Edge → Settings → System and performance → turn on **Use hardware acceleration when available**
    - Restart Edge completely.

2. **Check GPU/WebGL status**
    - Open `edge://gpu`
    - Look for:
      - **WebGL**: Hardware accelerated (or at least not "Disabled")
      - Any "Problems detected" lines mentioning WebGL being disabled.

3. **If you're in a sandbox / remote environment**
    - WebGL is often disabled in sandboxed browsers, some remote desktop sessions, and some enterprise policy environments.
    - Try opening the page in a normal local Edge/Chrome window (not an embedded preview browser).

4. **Optional flags (only if you know what you're doing)**
    - Open `edge://flags`
    - Try enabling **Override software rendering list** (then restart Edge).

If WebGL is disabled by policy/driver, the only fix is enabling GPU acceleration (or updating GPU drivers) so the browser can create a WebGL context.

## Features

*   **Visuals**: White/Blue theme, pine needle style leaves, realistic snowflakes.
*   **Animation**:
    *   Camera follows two light rays.
    *   Starts at ground, moves to root.
    *   Spirals up the tree.
    *   Converges at the top star.
    *   Star flashes, then camera zooms out.
