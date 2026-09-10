const notifications = document.getElementById("notifications");
if (notifications) {
  notifications.addEventListener("change", () => {
    console.log("notifications:", notifications.checked);
  });
}

const compact = document.getElementById("compact");
if (compact) {
  compact.addEventListener("change", () => {
    document.body.classList.toggle("compact", compact.checked);
  });
}
