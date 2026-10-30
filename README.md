# Quiz Battle Arena

A responsive, real-time multiplayer programming and technology quiz built with React, Vite, Express, and Socket.IO. Players join using a display name and a six-character room code. No player account is required.

## Features

- Create a room and share its six-character code
- Join from a separate browser, phone, or computer
- Host-configurable match length (3, 5, 8, 10, or 12 questions) and timer (10–45 seconds)
- Live lobby with connected-player state and host handoff while in the lobby
- Server-controlled question deadlines, answer validation, scoring, speed bonus, and results
- Correct answers stay on the server until the question's reveal phase
- One answer per player per question; validates room codes, names, options, and host actions
- Reconnection can restore the same player when the room code and session player ID are available
- Responsive dark navy, purple, and cyan design
- `/health` endpoint for hosting health checks

## Important status note

The source project is prepared, and the Node.js server files pass `node --check`. A full frontend build and end-to-end multiplayer test have **not** been verified in the authoring environment because dependency installation timed out. Run the checks below before treating the app as production-ready or submitting it.

## Run locally (no paid services required)

Requires Node.js 20+ (Node.js 22 LTS recommended) and npm on the machine where the app is run. If you do not want to install development tools on your own computer, use a browser-based coding workspace that supports Node.js projects and persistent WebSocket servers.

1. Extract the ZIP.
2. Open a terminal in the `quiz-battle-arena` project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the frontend and backend in development mode:

   ```bash
   npm run dev
   ```

5. Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The backend listens on port `3000`.
6. Test with two separate browser sessions. Create a room in one session, copy the code, and join from the other.

## Production build

```bash
npm install
npm run build
NODE_ENV=production npm start
```

The production server serves the compiled frontend and Socket.IO from the same origin. The server uses the hosting provider's `PORT` environment variable when supplied.

## Deploy to Render

A `render.yaml` Blueprint file is included as a deployment starting point.

1. Put this project in a GitHub repository (upload the extracted files, including `render.yaml`).
2. Sign in to Render and create a new Blueprint/web service from that repository.
3. Confirm the build command is `npm install && npm run build`, the start command is `npm start`, and `NODE_ENV=production` is set.
4. Wait for the build and deployment logs to report success.
5. Open the generated public URL and check `/health`. It should return JSON containing `"ok": true`.
6. Open the public URL in two separate browser sessions and test a complete match.

Free-tier availability and limits can change. The app requires a persistent Node.js web service with WebSocket support; static-only hosting is not sufficient. If the host requires a payment method or plan upgrade, stop rather than purchase anything without checking the terms.

## Architecture and limitations

- `src/` contains the React interface and Socket.IO client.
- `server/index.js` owns room state, timers, answers, and scoring.
- `server/questions.js` is the server-side question bank. Correct answers are not included in question payloads; they are sent only during reveal.
- Room state is in memory. Restarting the service clears active rooms. This single-process implementation is intended as a first version, not multi-instance scaling.
- Disconnected players are retained briefly to support reconnection. A reconnect must reuse the same room code and player ID stored in the browser session.
- No player account or database is used. Anyone with a room code may attempt to join while the lobby is open.
- Use the project as a starting point; perform the build and live multiplayer checks above before submission.

## Troubleshooting

- If dependencies fail to install, check the Node.js version and network access, then retry `npm install` in a supported environment.
- If the frontend opens but cannot connect, make sure the backend is running and port `3000` is available.
- If deployment fails, inspect the build logs and confirm the host supports WebSockets and runs `npm start`.
- If a room code is rejected, check all six characters and make sure the room is still active.
