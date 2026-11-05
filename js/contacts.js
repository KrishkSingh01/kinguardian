import parsePhoneNumber, { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { createVault, decryptJson, encryptJson, unlockVault } from "./encryption.js";
import { requestJson, showMessage } from "./auth-client.js";
import { communicationProviderStatus, prepareCommunication } from "./communication.js";

const vaultCard = document.querySelector("#vault-card");
const vaultForm = document.querySelector("#vault-form");
const vaultHeading = document.querySelector("#vault-heading");
const vaultExplainer = document.querySelector("#vault-explainer");
const vaultMessage = document.querySelector("#vault-message");
const vaultPassphrase = document.querySelector("#vault-passphrase");
const vaultConfirm = document.querySelector("#vault-passphrase-confirm");
const vaultConfirmWrap = document.querySelector("#vault-confirm-wrap");
const vaultWarning = document.querySelector("#vault-warning");
const vaultSubmit = document.querySelector("#vault-submit");
const contactWorkspace = document.querySelector("#contact-workspace");
const contactForm = document.querySelector("#contact-form");
const contactMessage = document.querySelector("#contact-message");
const contactList = document.querySelector("#contact-list");
const emptyContacts = document.querySelector("#empty-contacts");
const contactCount = document.querySelector("#contacts-count");
const contactFormTitle = document.querySelector("#contact-form-title");
const saveContact = document.querySelector("#save-contact");
const cancelEdit = document.querySelector("#cancel-edit");
const countryInputIds = ["#phone-country", "#whatsapp-country"];
const communicationDialog = document.querySelector("#communication-dialog");
const communicationRecipient = document.querySelector("#communication-recipient");
const communicationSubject = document.querySelector("#communication-subject");
const communicationSubjectLabel = document.querySelector("#communication-subject-label");
const communicationMessage = document.querySelector("#communication-message");
const communicationStatus = document.querySelector("#communication-status");
const communicationProviderNotice = document.querySelector("#communication-provider-status");
const openCommunication = document.querySelector("#open-communication");
const communicationAlertId = new URLSearchParams(location.search).get("alertId");

let signedInUser;
let vaultMetadata;
let dataKey;
let contacts = [];
let editingContactId = null;
let idleLockTimer;
let pageHiddenAt;
let communicationAlert;
let selectedCommunication;
const VAULT_IDLE_LIMIT_MS = 15 * 60 * 1000;
const countryLabels = new Map();

window.addEventListener("pagehide", () => {
  clearTimeout(idleLockTimer);
  dataKey = undefined;
  contacts = [];
  contactList.replaceChildren();
  resetContactForm();
  contactCount.textContent = "Locked";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener("pointerdown", resetVaultIdleLock);
window.addEventListener("keydown", resetVaultIdleLock);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pageHiddenAt = Date.now();
    return;
  }
  const leftFor = pageHiddenAt ? Date.now() - pageHiddenAt : 0;
  pageHiddenAt = undefined;
  if (dataKey && leftFor >= VAULT_IDLE_LIMIT_MS) lockVault();
  if (dataKey) {
    requestJson("/api/auth/me").catch(() => {
      lockVault();
      location.replace("login.html");
    });
  }
});
void initialize();

function resetVaultIdleLock() {
  if (!dataKey) return;
  clearTimeout(idleLockTimer);
  idleLockTimer = window.setTimeout(lockVault, VAULT_IDLE_LIMIT_MS);
}

function lockVault() {
  clearTimeout(idleLockTimer);
  dataKey = undefined;
  contacts = [];
  contactList.replaceChildren();
  resetContactForm();
  contactWorkspace.hidden = true;
  vaultCard.hidden = false;
  vaultForm.hidden = false;
  vaultPassphrase.value = "";
  vaultConfirm.value = "";
  if (vaultMetadata) {
    vaultHeading.textContent = "Unlock your private contacts";
    vaultExplainer.textContent = "Enter your separate encryption passphrase. It stays in this browser and is not sent to KinGuardian.";
    vaultSubmit.textContent = "Unlock contacts";
  }
  showMessage(vaultMessage, "Your private contacts are locked. Unlock them with your encryption passphrase.", "success");
}

async function initialize() {
  try {
    const { user } = await requestJson("/api/auth/me");
    signedInUser = user;
    if (user.mustChangePassword) {
      location.replace("change-password.html");
      return;
    }
    populateCountries();
    await loadCommunicationAlertContext();
    const response = await requestJson("/api/vault");
    vaultMetadata = response.vault;
    if (vaultMetadata) {
      vaultHeading.textContent = "Unlock your private contacts";
      vaultExplainer.textContent = "Enter your separate encryption passphrase. It stays in this browser and is not sent to KinGuardian.";
      vaultPassphrase.autocomplete = "new-password";
      vaultSubmit.textContent = "Unlock contacts";
    } else {
      vaultHeading.textContent = "Create your private data vault";
      vaultExplainer.textContent = "Choose a separate passphrase to encrypt contact details in this browser before they are saved.";
      vaultConfirmWrap.hidden = false;
      vaultConfirm.required = true;
      vaultWarning.hidden = false;
      vaultSubmit.textContent = "Create encrypted vault";
    }
    vaultForm.hidden = false;
  } catch (error) {
    vaultHeading.textContent = "Private contacts are unavailable";
    showMessage(vaultMessage, error.status === 401
      ? "Your sign-in has expired. Go back to sign in before managing contacts."
      : error.message || "Reconnect and try again. Private contact details have not been opened.");
    if (error.status === 401) location.replace("login.html");
    if (error.code === "PASSWORD_CHANGE_REQUIRED") location.replace("change-password.html");
  }
}

function populateCountries() {
  const list = document.querySelector("#country-options");
  let names;
  try { names = new Intl.DisplayNames([navigator.language || "en"], { type: "region" }); } catch { names = null; }
  const options = getCountries().map((country) => {
    let name;
    try { name = names?.of(country) || country; } catch { name = country; }
    const value = `${name} +${getCountryCallingCode(country)} (${country})`;
    countryLabels.set(value.toLocaleLowerCase(), country);
    return { value };
  });
  options.sort((left, right) => left.value.localeCompare(right.value, navigator.language || "en"));
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    list.append(element);
  }
  for (const selector of countryInputIds) {
    document.querySelector(selector).addEventListener("input", (event) => {
      const value = event.target.value.trim().toLocaleLowerCase();
      event.target.dataset.country = countryLabels.get(value) || "";
    });
  }
}

vaultForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  vaultSubmit.disabled = true;
  showMessage(vaultMessage, "Preparing your private vault…", "success");
  try {
    if (!vaultMetadata) {
      if (vaultPassphrase.value !== vaultConfirm.value) {
        throw new Error("The passphrases do not match.");
      }
      const created = await createVault(vaultPassphrase.value, signedInUser.userId);
      await requestJson("/api/vault", { method: "POST", body: created.metadata });
      dataKey = created.dataKey;
      vaultMetadata = created.metadata;
      vaultWarning.hidden = true;
    } else {
      dataKey = await unlockVault(vaultPassphrase.value, signedInUser.userId, vaultMetadata);
    }
    vaultPassphrase.value = "";
    vaultConfirm.value = "";
    vaultForm.hidden = true;
    vaultCard.hidden = true;
    contactWorkspace.hidden = false;
    resetVaultIdleLock();
    await loadContacts();
  } catch (error) {
    dataKey = undefined;
    showMessage(vaultMessage, error.code === "VAULT_ALREADY_EXISTS"
      ? "The vault may already have been created. Reload this page and unlock it with the passphrase you chose."
      : error.message || "The vault could not be opened.");
    vaultPassphrase.focus();
  } finally {
    vaultSubmit.disabled = false;
  }
});

async function loadContacts() {
  contactList.replaceChildren();
  contacts = [];
  try {
    const response = await requestJson("/api/contacts");
    for (const record of response.contacts) {
      try {
        const value = await decryptJson(record, dataKey, {
          userId: signedInUser.userId,
          recordType: "external_contact",
          recordId: record.contactId,
          keyVersion: record.keyVersion,
        });
        contacts.push({ ...record, value });
      } catch {
        const unavailable = document.createElement("li");
        unavailable.className = "contact-card";
        const notice = document.createElement("p");
        notice.textContent = "One encrypted contact could not be opened. It has not been changed.";
        unavailable.append(notice);
        contactList.append(unavailable);
      }
    }
    contacts.sort((left, right) => left.priority - right.priority || left.createdAt - right.createdAt);
    contacts.forEach((contact) => contactList.append(renderContact(contact)));
    emptyContacts.hidden = contacts.length > 0;
    contactCount.textContent = `${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}`;
  } catch (error) {
    showMessage(contactMessage, error.message || "Contacts could not be loaded.");
  }
}

function renderContact(contact) {
  const item = document.createElement("li");
  item.className = "contact-card";
  const name = document.createElement("h3");
  name.textContent = contact.value.name;
  item.append(name);
  if (contact.value.relationship) {
    const relationship = document.createElement("p");
    relationship.textContent = contact.value.relationship;
    item.append(relationship);
  }
  const methods = [];
  if (contact.value.methods.sms) methods.push(`SMS · ${contact.value.phone.e164}`);
  if (contact.value.methods.email) methods.push(`Email · ${contact.value.email}`);
  if (contact.value.methods.whatsapp) methods.push(`WhatsApp · ${contact.value.whatsapp.e164}`);
  const methodSummary = document.createElement("p");
  methodSummary.className = "contact-methods";
  methodSummary.textContent = methods.join(" · ");
  item.append(methodSummary);

  const actions = document.createElement("div");
  actions.className = "contact-card-actions";
  for (const [operation, text] of [["edit", "Edit"], ["delete", "Delete"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.dataset.operation = operation;
    button.dataset.contactId = contact.contactId;
    button.textContent = text;
    actions.append(button);
  }
  const manualMethods = [
    ["sms", "Prepare SMS", contact.value.methods.sms && contact.value.phone?.e164],
    ["email", "Prepare email", contact.value.methods.email && contact.value.email],
    ["whatsapp", "Prepare WhatsApp", contact.value.methods.whatsapp && contact.value.whatsapp?.e164],
  ];
  for (const [method, label, available] of manualMethods) {
    if (!available) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.dataset.operation = "compose";
    button.dataset.method = method;
    button.dataset.contactId = contact.contactId;
    button.textContent = label;
    actions.append(button);
  }
  item.append(actions);
  return item;
}

function parseInternationalNumber(numberInput, countryInput, label) {
  const raw = numberInput.value.trim();
  if (!raw) return null;
  const defaultCountry = raw.startsWith("+") ? undefined : countryInput.dataset.country;
  if (!defaultCountry && !raw.startsWith("+")) {
    throw new Error(`Choose the country or enter ${label} with a leading + and country calling code.`);
  }
  let parsed;
  try { parsed = defaultCountry ? parsePhoneNumber(raw, defaultCountry) : parsePhoneNumber(raw); } catch { parsed = undefined; }
  if (!parsed || !parsed.isValid()) {
    throw new Error(`Enter a valid international ${label} number for the selected country.`);
  }
  return { e164: parsed.number, country: parsed.country || defaultCountry || null };
}

function collectContact() {
  const name = document.querySelector("#contact-name").value.trim();
  if (!name) throw new Error("Enter a contact name.");
  const phone = parseInternationalNumber(document.querySelector("#phone-number"), document.querySelector("#phone-country"), "phone");
  const whatsapp = parseInternationalNumber(document.querySelector("#whatsapp-number"), document.querySelector("#whatsapp-country"), "WhatsApp");
  const email = document.querySelector("#contact-email").value.trim();
  const methods = {
    sms: document.querySelector("#method-sms").checked,
    email: document.querySelector("#method-email").checked,
    whatsapp: document.querySelector("#method-whatsapp").checked,
  };
  if (methods.sms && !phone) throw new Error("Add a phone number before enabling SMS.");
  if (methods.email && !email) throw new Error("Add an email address before enabling email.");
  if (methods.whatsapp && !whatsapp) throw new Error("Add a WhatsApp number before enabling WhatsApp.");
  if (!Object.values(methods).some(Boolean)) throw new Error("Enable at least one communication method for this contact.");
  return {
    value: {
      version: 1,
      name,
      relationship: document.querySelector("#contact-relationship").value.trim(),
      phone,
      email: email || null,
      whatsapp,
      methods,
    },
    priority: Number(document.querySelector("#contact-priority").value),
  };
}

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveContact.disabled = true;
  try {
    const { value, priority } = collectContact();
    const contactId = editingContactId || crypto.randomUUID();
    const encrypted = await encryptJson(value, dataKey, {
      userId: signedInUser.userId,
      recordType: "external_contact",
      recordId: contactId,
      keyVersion: 1,
    });
    const isEdit = Boolean(editingContactId);
    const path = isEdit ? `/api/contacts/${encodeURIComponent(contactId)}` : "/api/contacts";
    await requestJson(path, {
      method: isEdit ? "PUT" : "POST",
      body: {
        contactId,
        priority,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
        payloadFormat: 1,
      },
    });
    showMessage(contactMessage, isEdit ? "Contact updated and encrypted before saving." : "Contact encrypted in this browser and saved.", "success");
    resetContactForm();
    await loadContacts();
  } catch (error) {
    showMessage(contactMessage, error.message || "The contact could not be saved.");
  } finally {
    saveContact.disabled = false;
  }
});

contactList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-operation]");
  if (!button) return;
  const contact = contacts.find((item) => item.contactId === button.dataset.contactId);
  if (!contact) return;
  if (button.dataset.operation === "compose") {
    openCommunicationDialog(contact, button.dataset.method);
    return;
  }
  if (button.dataset.operation === "edit") {
    fillContactForm(contact);
    document.querySelector("#contact-name").focus();
    return;
  }
  if (button.dataset.operation === "delete" && window.confirm(`Remove ${contact.value.name} from this account? Its current encrypted data will be overwritten. Older database backups may still contain previous ciphertext.`)) {
    button.disabled = true;
    try {
      await requestJson(`/api/contacts/${encodeURIComponent(contact.contactId)}`, { method: "DELETE", body: {} });
      if (editingContactId === contact.contactId) resetContactForm();
      showMessage(contactMessage, "The contact was removed from your active list and its current encrypted data was overwritten.", "success");
      await loadContacts();
    } catch (error) {
      showMessage(contactMessage, error.message || "The contact could not be deleted.");
      button.disabled = false;
    }
  }
});

communicationMessage.addEventListener("input", updateCommunicationLink);
communicationSubject.addEventListener("input", updateCommunicationLink);
document.querySelector("#close-communication").addEventListener("click", () => communicationDialog.close());
openCommunication.addEventListener("click", (event) => {
  if (!selectedCommunication || openCommunication.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  showMessage(communicationStatus,
    "Composer launch requested. KinGuardian cannot confirm whether it opened, was sent, or was delivered.", "busy");
});
document.querySelector("#copy-communication").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(communicationMessage.value);
    showMessage(communicationStatus, "Message copied on this device. It has not been sent.", "success");
  } catch {
    showMessage(communicationStatus, "Copy was not available. Select the message text and copy it manually.");
  }
});

async function loadCommunicationAlertContext() {
  if (!communicationAlertId || !/^[0-9a-f-]{36}$/iu.test(communicationAlertId)) return;
  try {
    const { alerts } = await requestJson("/api/sos");
    communicationAlert = alerts.find((alert) => alert.alertId === communicationAlertId
      && alert.isSender && !alert.testMode && alert.status !== "closed");
  } catch {
    communicationAlert = undefined;
  }
}

function openCommunicationDialog(contact, method) {
  const recipient = method === "email" ? contact.value.email
    : method === "whatsapp" ? contact.value.whatsapp?.e164 : contact.value.phone?.e164;
  if (!recipient || !contact.value.methods[method]) {
    showMessage(contactMessage, "This method is not enabled for the selected contact.");
    return;
  }
  selectedCommunication = { method, recipient, contactName: contact.value.name };
  const methodNames = { sms: "SMS", email: "email", whatsapp: "WhatsApp" };
  communicationRecipient.textContent = `${methodNames[method]} composer for ${contact.value.name}`;
  communicationSubjectLabel.hidden = method !== "email";
  communicationSubject.hidden = method !== "email";
  communicationSubject.value = communicationAlert ? "I need help · KinGuardian SOS" : "I need help";
  communicationMessage.value = defaultCommunicationMessage();
  showMessage(communicationStatus, "Message prepared. It has not been sent.", "success");
  communicationProviderNotice.textContent = `Automatic provider: ${communicationProviderStatus(method)}. Manual composer only.`;
  communicationDialog.showModal();
  updateCommunicationLink();
  communicationMessage.focus();
}

function defaultCommunicationMessage() {
  if (!communicationAlert) return "I need help. Please contact me as soon as possible.";
  const createdAt = new Intl.DateTimeFormat(navigator.language, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: communicationAlert.senderTimezone, timeZoneName: "short",
  }).format(communicationAlert.createdAt);
  return `I need help. I created a KinGuardian SOS alert at ${createdAt}. Please contact me as soon as possible.`;
}

function updateCommunicationLink() {
  try {
    const prepared = prepareCommunication(selectedCommunication?.method, selectedCommunication?.recipient,
      communicationMessage.value, communicationSubject.value);
    openCommunication.href = prepared.url;
    openCommunication.textContent = `Open ${selectedCommunication.method === "whatsapp" ? "WhatsApp" : selectedCommunication.method === "sms" ? "SMS" : "email"} composer`;
    openCommunication.setAttribute("aria-disabled", "false");
    showMessage(communicationStatus, "Message prepared. Review it in the next app before choosing whether to send.", "success");
  } catch (error) {
    openCommunication.href = "#";
    openCommunication.textContent = "Prepare message";
    openCommunication.setAttribute("aria-disabled", "true");
    if (selectedCommunication) showMessage(communicationStatus, error.message);
  }
}

function countryLabel(country) {
  if (!country) return "";
  for (const [value, code] of countryLabels) {
    if (code === country) return [...document.querySelectorAll("#country-options option")].find((option) => option.value.toLocaleLowerCase() === value)?.value || "";
  }
  return "";
}

function setInternationalInput(countrySelector, numberSelector, internationalValue) {
  const countryInput = document.querySelector(countrySelector);
  const numberInput = document.querySelector(numberSelector);
  if (!internationalValue) return;
  countryInput.dataset.country = internationalValue.country || "";
  countryInput.value = countryLabel(internationalValue.country);
  numberInput.value = internationalValue.e164;
}

function fillContactForm(contact) {
  const value = contact.value;
  editingContactId = contact.contactId;
  document.querySelector("#contact-name").value = value.name;
  document.querySelector("#contact-relationship").value = value.relationship || "";
  setInternationalInput("#phone-country", "#phone-number", value.phone);
  document.querySelector("#contact-email").value = value.email || "";
  setInternationalInput("#whatsapp-country", "#whatsapp-number", value.whatsapp);
  document.querySelector("#method-sms").checked = Boolean(value.methods.sms);
  document.querySelector("#method-email").checked = Boolean(value.methods.email);
  document.querySelector("#method-whatsapp").checked = Boolean(value.methods.whatsapp);
  document.querySelector("#contact-priority").value = String(contact.priority);
  contactFormTitle.textContent = "Edit contact";
  saveContact.textContent = "Save encrypted changes";
  cancelEdit.hidden = false;
}

function resetContactForm() {
  contactForm.reset();
  for (const selector of countryInputIds) delete document.querySelector(selector).dataset.country;
  editingContactId = null;
  contactFormTitle.textContent = "Add a contact";
  saveContact.textContent = "Save encrypted contact";
  cancelEdit.hidden = true;
}

cancelEdit.addEventListener("click", resetContactForm);
