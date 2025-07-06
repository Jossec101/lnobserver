# LN Observer: Lightning Network Graph UI

LN Observer is an open-source React application that visualizes the Lightning Network as a dynamic, interactive world map. It fetches real-time channel and node data, detects channel open/close events, and animates lightning effects to highlight network activity.

![LN Observer Screenshot](public/ln-observer-favicon.svg)

## Features
- **World Map Visualization:** Interactive map of Lightning Network nodes and channels using D3 and TopoJSON.
- **Real-Time Updates:** Polls public APIs for the latest channel and node data.
- **Channel Event Detection:** Detects and animates channel open/close events with lightning effects and sound.
- **Debug Mode:** Simulate random lightning events for development.
- **Customizable:** Configure polling interval, animation duration, and more via `.env`.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation
```bash
# Clone the repository
git clone https://github.com/Jossec101/lnobserver.git
cd lnobserver
npm install
```

### Running the App
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production
```bash
npm run build
npm run preview
```

## Configuration
You can override settings in the `.env` file:

```
CHANNELS_GEO_API=https://mempool.space/api/v1/lightning/channels-geo
CHANNEL_METADATA_API=https://mempool.space/api/v1/lightning/channels/
DEBUG_LIGHTNING_ANIM=false
POLL_INTERVAL=10
MAX_CHANNEL_EVENTS=10000
ANIMATION_DURATION=60
```

## Project Structure
```
lnobserver/
├── public/                # Static assets (favicon, sound)
├── src/                   # React source code
│   ├── App.tsx            # Main app logic
│   ├── LightningGraph.tsx # Map and graph rendering
│   ├── index.css          # Styles
│   └── main.tsx           # Entry point
├── .env                   # Environment variables
├── package.json           # Project metadata and scripts
├── vite.config.js         # Vite configuration
└── README.md              # Project documentation
```

## License

MIT License
