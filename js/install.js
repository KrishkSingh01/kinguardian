const button = document.querySelector("#install-app");
const status = document.querySelector("#pwa-status");
const help = document.querySelector("#pwa-install-help");
let installPrompt = null;

if (button && status && help) {
  const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches
    || navigator.standalone === true;

  if (isInstalled()) {
    status.textContent = "Installed on this device";
    help.textContent = "KinGuardian opens in its app window on this device.";
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
    help.textContent = "Choose Install KinGuardian to add it to this device.";
  });

  button.addEventListener("click", async () => {
    if (!installPrompt) {
      help.textContent = "Open your browser menu and choose Install app or Add to Home screen.";
      return;
    }
    button.disabled = true;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === "accepted") help.textContent = "KinGuardian is being installed.";
      else help.textContent = "Installation was cancelled. You can try again from the browser menu.";
    } catch {
      help.textContent = "The browser could not start installation. Try its menu and choose Add to Home screen.";
    } finally {
      installPrompt = null;
      button.hidden = true;
      button.disabled = false;
    }
  });

  window.addEventListener("appinstalled", () => {
    status.textContent = "Installed on this device";
    help.textContent = "KinGuardian opens in its app window on this device.";
    button.hidden = true;
    installPrompt = null;
  });
}
