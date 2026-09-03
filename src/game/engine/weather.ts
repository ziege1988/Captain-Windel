// Weather is a layer on top of the arena palettes, not a replacement for
// them: an arena still owns its own sky/ground colours and its own
// palette effects (grass, snow, lava smoke), and the weather then tints,
// clouds over, rains on and blows through whatever that arena is. A fresh
// one is rolled for every level and every time the main menu is opened, so
// the same arena genuinely looks different each visit.

export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'windy' | 'storm';

export interface WeatherState {
  id: WeatherId;
  name: string;
  icon: string;
  /** 0..1 — how many clouds and how heavy they look. */
  cloudCover: number;
  /** 0..1 — how far the sky is pulled towards flat overcast grey. */
  darken: number;
  /** 0..1 — precipitation density. */
  rain: number;
  /** Multiplier on the shared wind gust every swaying thing already reads. */
  wind: number;
  /** 0..1 — autumn leaves torn loose and blown across the arena. */
  leaves: number;
  /** Whether the sky flashes and bolts can actually come down. */
  lightning: boolean;
}

export const WEATHERS: Record<WeatherId, WeatherState> = {
  clear: {
    id: 'clear', name: 'Sonnenschein', icon: '☀️',
    cloudCover: 0.25, darken: 0, rain: 0, wind: 1, leaves: 0, lightning: false,
  },
  cloudy: {
    id: 'cloudy', name: 'Bewölkt', icon: '☁️',
    cloudCover: 0.85, darken: 0.28, rain: 0, wind: 1.4, leaves: 0.15, lightning: false,
  },
  rain: {
    id: 'rain', name: 'Regen', icon: '🌧️',
    cloudCover: 1, darken: 0.45, rain: 0.75, wind: 1.6, leaves: 0.1, lightning: false,
  },
  windy: {
    id: 'windy', name: 'Herbstwind', icon: '🍂',
    cloudCover: 0.6, darken: 0.18, rain: 0, wind: 3.2, leaves: 1, lightning: false,
  },
  storm: {
    id: 'storm', name: 'Gewitter', icon: '⛈️',
    cloudCover: 1, darken: 0.6, rain: 1, wind: 2.4, leaves: 0.2, lightning: true,
  },
};

const WEATHER_IDS = Object.keys(WEATHERS) as WeatherId[];

/** Rolls a fresh random weather. `avoid` keeps the same one from coming up
 * twice in a row, so consecutive levels (and consecutive trips to the main
 * menu) visibly differ rather than sometimes looking identical. */
export function pickRandomWeather(avoid?: WeatherId): WeatherState {
  const pool = avoid && WEATHER_IDS.length > 1 ? WEATHER_IDS.filter((id) => id !== avoid) : WEATHER_IDS;
  return WEATHERS[pool[Math.floor(Math.random() * pool.length)]];
}

// The scene's current weather. It is a module-level value on purpose: the
// wind it produces is read from deep inside the fighter renderer (cape,
// hair, clothing) and the arena effects (grass, flowers, leaves), all of
// which already share one "wind" concept via windGust and none of which
// have — or want — a path to thread a weather argument down. renderArena
// sets it once per frame from whatever weather it was handed.
let sceneWeather: WeatherState = WEATHERS.clear;

export function setSceneWeather(w: WeatherState): void {
  sceneWeather = w;
}

export function getSceneWeather(): WeatherState {
  return sceneWeather;
}
