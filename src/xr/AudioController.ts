import {STATIONS} from '../constants';

export type AudioStateListener = (
  event: 'started' | 'ended' | 'blocked',
  stationIndex: number
) => void;

/**
 * Guarantees only one station audio track (parte1.mp3..parte4.mp3) plays at a time.
 * Selecting a new station stops and rewinds any active track immediately.
 */
export class AudioController {
  private readonly tracks: HTMLAudioElement[] = [];
  private activeIndex: number | null = null;
  private listener?: AudioStateListener;
  private disposed = false;

  constructor(listener?: AudioStateListener) {
    this.listener = listener;
    if (typeof Audio !== 'undefined') {
      for (const station of STATIONS) {
        const audio = new Audio(station.audioFile);
        audio.preload = 'auto';
        audio.addEventListener('ended', () => {
          if (this.disposed) return;
          if (this.activeIndex === station.index) {
            this.activeIndex = null;
            this.listener?.('ended', station.index);
          }
        });
        this.tracks.push(audio);
      }
    }
  }

  setListener(listener: AudioStateListener): void {
    this.listener = listener;
  }

  /**
   * Unlocks audio playback on user gesture (such as clicking Enter VR).
   */
  unlock(): void {
    for (const audio of this.tracks) {
      if (audio.readyState === 0) {
        audio.load();
      }
    }
  }

  playStation(stationIndex: number): void {
    if (this.disposed) return;
    this.stopAll();

    const audio = this.tracks[stationIndex];
    if (!audio) return;

    this.activeIndex = stationIndex;
    audio.currentTime = 0;

    const playPromise = audio.play();
    this.listener?.('started', stationIndex);

    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Browser blocked autoplay before user gesture; still keep station visual active
        // and notify listener so UX stays responsive.
        if (!this.disposed && this.activeIndex === stationIndex) {
          this.listener?.('blocked', stationIndex);
        }
      });
    }
  }

  stopAll(): void {
    for (const audio of this.tracks) {
      if (!audio.paused) {
        audio.pause();
      }
      audio.currentTime = 0;
    }
    this.activeIndex = null;
  }

  getActiveIndex(): number | null {
    return this.activeIndex;
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    this.tracks.length = 0;
  }
}
