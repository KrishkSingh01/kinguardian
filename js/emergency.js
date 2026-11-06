const country = document.querySelector("#emergency-country");
const india = document.querySelector("#india-emergency");
const other = document.querySelector("#other-emergency");

country.addEventListener("change", () => {
  const isIndia = country.value === "india";
  india.hidden = !isIndia;
  other.hidden = isIndia;
});
