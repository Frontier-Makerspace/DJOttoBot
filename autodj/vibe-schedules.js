const fs = require('fs');
const path = require('path');

const VIBE_CONFIG_FILE = path.join(__dirname, 'vibe-config.json');

const DEFAULT_SCHEDULES = [
  {
    startHour: 0,
    endHour: 7,
    name: 'Late Night',
    tags: ['KMFDM', 'Depeche Mode', 'Nine Inch Nails'],
    queries: [],
  },
  {
    startHour: 7,
    endHour: 12,
    name: 'Afternoon',
    tags: ['Antenna', 'Corey Hart', 'Duran Duran'],
    queries: [],
  },
  {
    startHour: 12,
    endHour: 17,
    name: 'Antenna Club',
    tags: ['Antenna'],
    queries: [],
  },
  {
    startHour: 17,
    endHour: 22,
    name: 'Evening',
    tags: ['Front 242', 'Combichrist', 'KMFDM', 'Nine Inch Nails', 'Covenant', 'Assemblage 23', 'And One'],
    queries: [],
  },
  {
    startHour: 22,
    endHour: 24,
    name: 'Peak Hours',
    tags: ['KMFDM', 'Front 242', 'Covenant', 'Combichrist', 'Nine Inch Nails'],
    queries: [],
  },
];

function loadVibeConfig() {
  try {
    if (fs.existsSync(VIBE_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(VIBE_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.log(`[Vibes] Failed to load vibe-config.json: ${err.message}`);
  }
  // Create default config file if it doesn't exist
  const config = { schedules: DEFAULT_SCHEDULES };
  saveVibeConfig(config);
  return config;
}

function saveVibeConfig(config) {
  try {
    fs.writeFileSync(VIBE_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.log(`[Vibes] Failed to save vibe-config.json: ${err.message}`);
  }
}

function getVibeForHour(hour) {
  const config = loadVibeConfig();

  for (const schedule of config.schedules) {
    if (hour >= schedule.startHour && hour < schedule.endHour) {
      return {
        name: schedule.name,
        localOnly: true,
        tags: schedule.tags || [],
        queries: schedule.queries || [],
      };
    }
  }

  // Fallback: Peak Hours (matches old default for hour 22-23)
  return {
    name: 'Peak Hours',
    localOnly: true,
    tags: ['KMFDM', 'Front 242', 'Covenant', 'Combichrist', 'Nine Inch Nails'],
    queries: [],
  };
}

module.exports = { getVibeForHour, loadVibeConfig, saveVibeConfig };
