import { requestJson, showMessage } from "./auth-client.js";

const manager = document.querySelector("#recovery-code-manager");
if (manager) {
  const openButton = document.querySelector("#manage-recovery-codes");
  const form = document.querySelector("#recovery-code-form");
  const submit = document.querySelector("#save-recovery-codes");
  const result = document.querySelector("#recovery-codes-result");
  const output = document.querySelector("#account-recovery-codes");
  const message = document.querySelector("#recovery-codes-message");

  openButton.addEventListener("click", () => {
    form.hidden = false;
    form.querySelector("input").focus();
    showMessage(message, "Enter your current password. A new set will replace every old code.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    showMessage(message, "Checking your password…", "busy");
    try {
      const { recoveryCodes } = await requestJson("/api/auth/recovery-codes", {
        method: "POST",
        body: { password: new FormData(form).get("password") },
      });
      if (!Array.isArray(recoveryCodes) || recoveryCodes.length !== 10) {
        throw new Error("The new recovery codes could not be displayed. Try again.");
      }
      output.value = recoveryCodes.join("\n");
      form.reset();
      form.hidden = true;
      openButton.hidden = true;
      result.hidden = false;
      showMessage(message, "Save these new codes now. Your previous codes no longer work.", "success");
    } catch (error) {
      form.reset();
      showMessage(message, error.message || "The recovery codes could not be replaced.");
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#copy-account-recovery-codes").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      showMessage(message, "Recovery codes copied. Store them somewhere private.", "success");
    } catch {
      output.focus();
      output.select();
      showMessage(message, "Copy was unavailable. Select the codes and copy them manually.");
    }
  });

  document.querySelector("#done-saving-recovery-codes").addEventListener("click", () => {
    output.value = "";
    result.hidden = true;
    openButton.hidden = false;
    showMessage(message, "Recovery codes hidden from this page. Keep your saved copy private.", "success");
  });
}
