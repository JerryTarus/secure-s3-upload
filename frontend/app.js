// DOM Elements
const fileInput = document.getElementById("fileInput");
const dropArea = document.getElementById("dropArea");
const previewContainer = document.getElementById("previewContainer");
const previewImage = document.getElementById("previewImage");
const statusMessage = document.getElementById("statusMessage");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const uploadButton = document.getElementById("uploadButton");
const successLinkContainer = document.getElementById("successLinkContainer");
const objectLink = document.getElementById("objectLink");

// State
let selectedFile = null;

// Event Listeners
fileInput.addEventListener("change", handleFileSelect);
dropArea.addEventListener("dragover", handleDragOver);
dropArea.addEventListener("drop", handleDrop);
dropArea.addEventListener("click", () => fileInput.click());

/**
 * Handle file selection via input
 */
function handleFileSelect(e) {
  const file = e.target.files[0];
  validateAndDisplayFile(file);
}

/**
 * Handle drag-over event (prevent default to allow drop)
 */
function handleDragOver(e) {
  e.preventDefault();
  dropArea.classList.add("border-primary");
}

/**
 * Handle drop event
 */
function handleDrop(e) {
  e.preventDefault();
  dropArea.classList.remove("border-primary");
  const file = e.dataTransfer.files[0];
  validateAndDisplayFile(file);
}

/**
 * Validate file and display preview
 * @param {File} file
 */
function validateAndDisplayFile(file) {
  if (!file) return;

  // Reset UI
  clearStatus();
  hideSuccessLink();
  uploadButton.disabled = true;

  // Validate file size (max 5MB)
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX_SIZE) {
    showError("File too large. Max 5MB allowed.");
    return;
  }

  // Validate MIME type
  if (!file.type.startsWith("image/")) {
    showError("Invalid file type. Only images (JPEG, PNG, GIF, WEBP) allowed.");
    return;
  }

  // Allowed types (optional client-side check)
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    showError(
      `Unsupported image type: ${file.type}. Allowed: JPEG, PNG, GIF, WEBP.`
    );
    return;
  }

  // Display preview
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    previewContainer.classList.remove("hidden");
  };
  reader.readAsDataURL(file);

  // Store file and enable upload button
  selectedFile = file;
  uploadButton.disabled = false;
  showStatus(
    `Ready to upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(
      2
    )} MB)`,
    "text-accent"
  );
}

/**
 * Upload file to S3 using pre-signed URL
 */
async function uploadFile() {
  if (!selectedFile) {
    showError("No file selected.");
    return;
  }

  showStatus("Requesting upload URL...", "text-accent");
  uploadButton.disabled = true;

  try {
    // DEBUG: Log before fetch
    console.log(">>> DEBUG: Calling API Gateway...");
    console.log(
      ">>> API URL:",
      "https://px0m3rkcp4.execute-api.eu-north-1.amazonaws.com/upload"
    );
    console.log(">>> File:", selectedFile.name, "| Type:", selectedFile.type);

    // Step 1: Request pre-signed URL from Lambda via API Gateway
    const response = await fetch(
      "https://px0m3rkcp4.execute-api.eu-north-1.amazonaws.com/upload?v=2",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType: selectedFile.type,
        }),
      }
    );

    // DEBUG: Log response status
    console.log(">>> Response status:", response.status);

    // DEBUG: Log response headers
    console.log(
      ">>> Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to get upload URL");
    }

    // DEBUG: Get response as text first to see raw content
    const responseText = await response.text();
    console.log(">>> Raw response text:", responseText);

    // Try to parse as JSON
    let responseData;
    try {
      responseData = JSON.parse(responseText);
      console.log(">>> Parsed response data:", responseData);
    } catch (parseError) {
      console.error(">>> JSON Parse Error:", parseError);
      throw new Error("Server returned invalid JSON: " + responseText);
    }

    // Check for different possible response structures
    let url, key;

    if (responseData.url && responseData.key) {
      // Standard format
      url = responseData.url;
      key = responseData.key;
    } else if (responseData.uploadUrl && responseData.key) {
      // Alternative format
      url = responseData.uploadUrl;
      key = responseData.key;
    } else if (responseData.presignedUrl && responseData.objectKey) {
      // Another alternative format
      url = responseData.presignedUrl;
      key = responseData.objectKey;
    } else {
      // Log all available properties
      console.error(
        ">>> Available response properties:",
        Object.keys(responseData)
      );
      throw new Error(
        "Invalid response from server - missing url/key properties"
      );
    }

    if (!url || !key) {
      throw new Error("Invalid response from server - empty url or key");
    }

    // DEBUG: Log received data
    console.log(">>> Received signed URL:", url);
    console.log(">>> Object key:", key);

    // Step 2: Upload file to S3 using pre-signed URL
    showStatus("Uploading file...", "text-accent");
    progressContainer.classList.remove("hidden");

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = `${percentComplete}%`;
        progressText.textContent = `${percentComplete}%`;
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        // Construct the S3 object URL
        const s3Url = `https://crotonn-uploads-bucket.s3.eu-north-1.amazonaws.com/${key}`;
        objectLink.href = s3Url;
        objectLink.textContent = s3Url;
        successLinkContainer.classList.remove("hidden");
        showStatus("Upload complete!", "text-success");
      } else {
        showError(`Upload failed: HTTP ${xhr.status}`);
        console.log(">>> S3 Upload Response:", xhr.responseText);
      }
      uploadButton.disabled = false;
    });

    xhr.addEventListener("error", () => {
      showError("Upload failed due to network error.");
      uploadButton.disabled = false;
    });
    // Trim any leading/trailing spaces from URL
    url = url.trim();
    console.log(">>> CLEANED URL:", url);

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", selectedFile.type);
    xhr.send(selectedFile);
  } catch (error) {
    console.error(">>> FATAL ERROR:", error);
    showError(`Error: ${error.message}`);
    uploadButton.disabled = false;
  }
}

/**
 * Utility: Show error message
 * @param {string} message
 */
function showError(message) {
  statusMessage.textContent = message;
  statusMessage.className = "text-error text-sm font-medium";
}

/**
 * Utility: Show generic status message
 * @param {string} message
 * @param {string} className - Tailwind text color class
 */
function showStatus(message, className = "text-accent") {
  statusMessage.textContent = message;
  statusMessage.className = className;
}

/**
 * Utility: Clear status
 */
function clearStatus() {
  statusMessage.textContent = "";
  progressContainer.classList.add("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
}

/**
 * Utility: Hide success link
 */
function hideSuccessLink() {
  successLinkContainer.classList.add("hidden");
}
