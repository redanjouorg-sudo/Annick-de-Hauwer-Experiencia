import * as xb from 'xrblocks';

import {VRExperienceScript} from './xr/VRExperienceScript';

function ensureBottomEnterVRButton(experience: VRExperienceScript): void {
  // When WebXR immersive-vr is supported, XR Blocks keeps #XRButtonWrapper mounted
  // at the bottom center (styled via src/index.css) with label "Enter VR".
  if (document.getElementById('XRButtonWrapper')) {
    return;
  }

  if (document.getElementById('vr-bottom-dock')) {
    return;
  }

  const dock = document.createElement('div');
  dock.id = 'vr-bottom-dock';

  const button = document.createElement('button');
  button.id = 'vr-fallback-button';
  button.type = 'button';
  button.className = 'XRButton';
  button.textContent = 'Enter VR';
  button.setAttribute('aria-label', 'Enter VR');

  button.addEventListener('click', () => {
    experience.unlockAudio();
    const sessionManager = xb.core.webXRSessionManager;
    if (sessionManager?.isXRSupported()) {
      if (sessionManager.currentSession) {
        void sessionManager.endSession();
      } else {
        sessionManager.startSession();
      }
      return;
    }

    // Desktop / non-WebXR fallback: toggle fullscreen VR view cleanly
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
      button.textContent = 'Exit VR';
    } else {
      void document.exitFullscreen?.().catch(() => {});
      button.textContent = 'Enter VR';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !xb.core.webXRSessionManager?.currentSession) {
      button.textContent = 'Enter VR';
    }
  });

  dock.append(button);
  document.body.appendChild(dock);
}

async function start(): Promise<void> {
  const options = new xb.Options();
  options.enableVR();
  options.reticles.enabled = false;
  options.hands.enabled = false;
  options.controllers.visualizeRays = false;
  options.controllers.visualization = false;
  options.xrButton.enabled = true;
  options.xrButton.startText = 'Enter VR';
  options.xrButton.endText = 'Exit VR';

  const experience = new VRExperienceScript();
  xb.add(experience);
  await xb.init(options);
  ensureBottomEnterVRButton(experience);
}

document.addEventListener('DOMContentLoaded', () => {
  void start();
});
