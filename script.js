// Cloudflare Worker endpoint that proxies chat requests to OpenAI
const WORKER_URL = "https://loreal-chatbot.sklamons2019.workers.dev/";

// Relative path so products.json works locally and on GitHub Pages project sites
const PRODUCTS_URL = "./products.json";
const STORAGE_KEY = "lorealSelectedProductIds";

// Chat DOM elements
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const messages = document.getElementById("messages");
const latestQuestion = document.getElementById("latestQuestion");
const latestQuestionText = document.getElementById("latestQuestionText");
const sendButton = document.getElementById("sendBtn");
const webSearchToggle = document.getElementById("webSearchToggle");
const chatStatus = document.getElementById("chatStatus");

// Product browser and routine builder DOM elements
const productSearch = document.getElementById("productSearch");
const categoryFilter = document.getElementById("categoryFilter");
const rtlToggle = document.getElementById("rtlToggle");
const catalogStatus = document.getElementById("catalogStatus");
const productGrid = document.getElementById("productGrid");
const selectedCount = document.getElementById("selectedCount");
const selectedEmpty = document.getElementById("selectedEmpty");
const selectedList = document.getElementById("selectedList");
const clearSelectedButton = document.getElementById("clearSelectedBtn");
const generateRoutineButton = document.getElementById("generateRoutineBtn");

// Application state
let allProducts = [];
let selectedProductIds = [];
let isRequestInProgress = false;

// Conversation history starts with the strict L'Oréal beauty-topic system prompt
const chatHistory = [
  {
    role: "system",
    content: [
      "You are the L’Oréal Beauty Assistant. Help users with skincare, haircare, makeup, fragrance, and beauty routines.",
      "Answer requests with a clear beauty connection. Use earlier turns to answer clear follow-up questions, and briefly acknowledge greetings.",
      "If a message is unrelated or too ambiguous to connect to beauty, reply exactly: I can help with skincare, haircare, makeup, and fragrance. What would you like to explore?",
      "Do not guess a beauty connection or recommend products for unrelated input. For example, redirect the standalone words 'moon' and 'horse', but answer 'moon-inspired makeup'.",
      "If a request is clearly about beauty but needs more detail, ask one focused clarifying question.",
      "Keep replies concise and in plain text. Use numbered lists for routines.",
    ].join(" "),
  },
];

// Escape special HTML characters before inserting text into template literals
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Format category values like "men's grooming" into readable dropdown labels
function formatCategoryLabel(category) {
  return String(category || "Other")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Read saved product IDs from localStorage safely
function loadSavedSelectionIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
  } catch (error) {
    console.warn("Could not read saved selections from localStorage:", error);
    return [];
  }
}

// Save the current selected product IDs to localStorage
function saveSelectionIds() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProductIds));
  } catch (error) {
    console.warn("Could not save selections to localStorage:", error);
  }
}

// Return the full product objects that match the currently selected IDs
function getSelectedProducts() {
  return selectedProductIds
    .map((id) => allProducts.find((product) => String(product.id) === id))
    .filter(Boolean);
}

// Check whether a product ID is currently selected
function isProductSelected(productId) {
  return selectedProductIds.includes(String(productId));
}

// Keep Clear All, Generate Routine, and Send button disabled states accurate
function updateActionButtons() {
  const hasSelection = selectedProductIds.length > 0;
  clearSelectedButton.disabled = !hasSelection;
  generateRoutineButton.disabled = !hasSelection || isRequestInProgress;
  sendButton.disabled = isRequestInProgress;
}

// Populate the category <select> using the unique categories from products.json
function populateCategoryDropdown() {
  const categories = [...new Set(allProducts.map((product) => product.category).filter(Boolean))];
  const optionsHtml = categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`
    )
    .join("");

  categoryFilter.innerHTML = `<option value="all">All Categories</option>${optionsHtml}`;
}

// Normalize search text by trimming, collapsing spaces, lowercasing, and mapping spaced variants
function normalizeSearchQuery(rawQuery) {
  const collapsed = String(rawQuery || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  const spacedVariantMap = {
    "make up": "makeup",
    "hair care": "haircare",
    "skin care": "skincare",
    "sun care": "suncare",
  };

  if (spacedVariantMap[collapsed]) {
    return spacedVariantMap[collapsed];
  }

  return collapsed
    .replace(/\bmake up\b/g, "makeup")
    .replace(/\bhair care\b/g, "haircare")
    .replace(/\bskin care\b/g, "skincare")
    .replace(/\bsun care\b/g, "suncare");
}

// Build and render the product grid for the active category and search filters
function renderProductGrid() {
  const activeCategory = categoryFilter.value;
  const rawSearch = productSearch.value.trim();
  const collapsedQuery = rawSearch.toLowerCase().replace(/\s+/g, " ");
  const searchQuery = normalizeSearchQuery(rawSearch);

  // Collect exact category names present in products.json
  const availableCategories = new Set(
    allProducts
      .map((product) => String(product.category || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const exactCategoryMatch = availableCategories.has(searchQuery)
    ? searchQuery
    : null;

  // Apply both category dropdown and search filters together
  const visibleProducts = allProducts.filter((product) => {
    const productCategory = String(product.category || "").trim().toLowerCase();
    const matchesCategoryDropdown =
      activeCategory === "all" || product.category === activeCategory;
    if (!matchesCategoryDropdown) return false;

    if (!searchQuery) return true;

    // Exact category queries only match products in that category
    if (exactCategoryMatch) {
      return productCategory === exactCategoryMatch;
    }

    // Other queries match partially across name, brand, category, and description
    const searchableText = [
      product.name,
      product.brand,
      product.category,
      product.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      searchableText.includes(searchQuery) ||
      searchableText.includes(collapsedQuery)
    );
  });

  const categoryText =
    activeCategory === "all"
      ? "all categories"
      : formatCategoryLabel(activeCategory);

  if (visibleProducts.length === 0) {
    catalogStatus.textContent = "No matching products found.";
    const searchDetail = rawSearch ? ` for "${escapeHtml(rawSearch)}"` : "";
    const categoryDetail =
      activeCategory === "all"
        ? ""
        : ` in ${escapeHtml(formatCategoryLabel(activeCategory))}`;

    productGrid.innerHTML = `
      <p class="empty-catalog-message" dir="ltr">
        No products found${searchDetail}${categoryDetail}. Try a different keyword or switch back to All Categories.
      </p>
    `;
    return;
  }

  const searchLabel = rawSearch ? ` matching "${rawSearch}"` : "";
  catalogStatus.textContent = `Showing ${visibleProducts.length} product${visibleProducts.length === 1 ? "" : "s"}${searchLabel} in ${categoryText}.`;

  productGrid.innerHTML = visibleProducts
    .map((product) => {
      const productId = String(product.id);
      const selected = isProductSelected(productId);
      const brand = product.brand || "L'Oréal";
      const name = product.name || "Untitled Product";
      const category = product.category || "beauty";
      const description =
        product.description || "No product description provided.";
      const image = product.image || "./img/loreal-logo.png";

      return `
        <article class="product-card ${selected ? "is-selected" : ""}" data-card-id="${escapeHtml(productId)}">
          <div class="product-card-top">
            <span class="product-category" dir="ltr">${escapeHtml(formatCategoryLabel(category))}</span>
            ${selected ? `<span class="product-selected-badge" dir="ltr">Selected</span>` : ""}
          </div>

          <div class="product-image-wrap">
            <img
              src="${escapeHtml(image)}"
              alt="${escapeHtml(`${brand} ${name}`)}"
              loading="lazy"
            />
          </div>

          <p class="product-brand" dir="ltr">${escapeHtml(brand)}</p>
          <h3 class="product-name" dir="ltr">${escapeHtml(name)}</h3>

          <details class="product-disclosure">
            <summary class="product-disclosure-summary"><span dir="ltr">Product details</span></summary>
            <p class="product-description" dir="ltr">${escapeHtml(description)}</p>
          </details>

          <button
            type="button"
            class="product-select-btn"
            dir="ltr"
            data-product-id="${escapeHtml(productId)}"
            aria-pressed="${selected ? "true" : "false"}"
          >
            ${selected ? "Selected" : "Select Product"}
          </button>
        </article>
      `;
    })
    .join("");
}

// Update visible cards in place so keyboard focus and open <details> stay intact
function syncProductCardStates() {
  productGrid.querySelectorAll(".product-card").forEach((card) => {
    const productId = card.dataset.cardId;
    const selected = isProductSelected(productId);
    const topRow = card.querySelector(".product-card-top");
    const existingBadge = card.querySelector(".product-selected-badge");
    const selectBtn = card.querySelector(".product-select-btn");

    card.classList.toggle("is-selected", selected);

    if (selected && !existingBadge && topRow) {
      topRow.insertAdjacentHTML(
        "beforeend",
        `<span class="product-selected-badge" dir="ltr">Selected</span>`
      );
    } else if (!selected && existingBadge) {
      existingBadge.remove();
    }

    if (selectBtn) {
      selectBtn.setAttribute("aria-pressed", selected ? "true" : "false");
      selectBtn.textContent = selected ? "Selected" : "Select Product";
    }
  });
}

// Render the Selected Products list, count, and empty state
function renderSelectedProducts() {
  const selectedProducts = getSelectedProducts();
  selectedCount.textContent = String(selectedProducts.length);

  if (selectedProducts.length === 0) {
    selectedEmpty.hidden = false;
    selectedList.hidden = true;
    selectedList.innerHTML = "";
    updateActionButtons();
    return;
  }

  selectedEmpty.hidden = true;
  selectedList.hidden = false;

  selectedList.innerHTML = selectedProducts
    .map((product) => {
      const productId = String(product.id);
      const brand = product.brand || "L'Oréal";
      const name = product.name || "Untitled Product";
      const category = product.category
        ? formatCategoryLabel(product.category)
        : "Beauty";

      return `
        <li class="selected-item">
          <div class="selected-item-info">
            <span class="selected-item-name" dir="ltr">${escapeHtml(name)}</span>
            <span class="selected-item-meta" dir="ltr">${escapeHtml(`${brand} · ${category}`)}</span>
          </div>
          <button
            type="button"
            class="remove-selected-btn"
            dir="ltr"
            data-product-id="${escapeHtml(productId)}"
            aria-label="Remove ${escapeHtml(`${brand} ${name}`)} from selected products"
          >
            Remove
          </button>
        </li>
      `;
    })
    .join("");

  updateActionButtons();
}

// Add or remove a product ID from selection and persist to localStorage
function toggleProductSelection(productId) {
  const normalizedId = String(productId);

  if (isProductSelected(normalizedId)) {
    selectedProductIds = selectedProductIds.filter((id) => id !== normalizedId);
  } else {
    selectedProductIds = [...selectedProductIds, normalizedId];
  }

  saveSelectionIds();
  syncProductCardStates();
  renderSelectedProducts();
}

// Remove a single product from the Selected Products panel
function removeProductSelection(productId) {
  const normalizedId = String(productId);
  selectedProductIds = selectedProductIds.filter((id) => id !== normalizedId);

  saveSelectionIds();
  syncProductCardStates();
  renderSelectedProducts();
}

// Clear all selected products
function clearAllSelections() {
  selectedProductIds = [];
  saveSelectionIds();
  syncProductCardStates();
  renderSelectedProducts();
}

// Load products.json on page load and restore any saved selections
async function loadProducts() {
  catalogStatus.textContent = "Loading products…";

  try {
    const response = await fetch(PRODUCTS_URL);
    if (!response.ok) {
      throw new Error(`Failed to load products (${response.status})`);
    }

    const data = await response.json();
    const products = Array.isArray(data) ? data : data.products;

    if (!Array.isArray(products)) {
      throw new Error("Invalid products.json format.");
    }

    allProducts = products;
    populateCategoryDropdown();

    // Keep only saved IDs that match products currently in the catalog
    const validIds = new Set(allProducts.map((product) => String(product.id)));
    selectedProductIds = loadSavedSelectionIds().filter((id) => validIds.has(id));
    saveSelectionIds();

    renderProductGrid();
    renderSelectedProducts();
  } catch (error) {
    console.error("Could not load products.json:", error);
    catalogStatus.textContent =
      "Unable to load the product catalog right now. Please refresh to try again.";
    productGrid.innerHTML = "";
    renderSelectedProducts();
  }
}

// Validate that a citation URL uses only safe http or https protocols
function getSafeHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

// Create a safe clickable inline citation link using DOM methods
function createInlineCitationLink(source) {
  const link = document.createElement("a");
  link.className = "inline-citation-link";
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("dir", "ltr");

  const label = source.title ? `${source.title} (${source.hostname})` : source.hostname;
  link.title = label;
  link.setAttribute("aria-label", `Source ${source.number}: ${label}`);
  link.append(document.createTextNode(`[${source.number}]`));
  return link;
}

// Render answer text and clickable inline citations using only DOM text nodes and safe links
function renderMessageWithCitations(paragraph, rawText, rawCitations) {
  const leadingTrim = rawText.length - rawText.trimStart().length;
  const text = rawText.trim();

  // Keep only citations that have valid http/https URLs
  const uniqueSourcesByUrl = new Map();
  const orderedSources = [];
  const validCitations = [];

  for (const citation of rawCitations) {
    const safeUrl = getSafeHttpUrl(citation?.url);
    if (!safeUrl) continue;

    let source = uniqueSourcesByUrl.get(safeUrl);
    if (!source) {
      let hostname = safeUrl;
      try {
        hostname = new URL(safeUrl).hostname.replace(/^www\./, "");
      } catch {
        hostname = safeUrl;
      }

      source = {
        number: orderedSources.length + 1,
        url: safeUrl,
        title: typeof citation.title === "string" ? citation.title.trim() : "",
        hostname,
      };
      uniqueSourcesByUrl.set(safeUrl, source);
      orderedSources.push(source);
    }

    const hasOffsets =
      Number.isInteger(citation.start_index) &&
      Number.isInteger(citation.end_index);

    const start = hasOffsets ? citation.start_index - leadingTrim : -1;
    const end = hasOffsets ? citation.end_index - leadingTrim : -1;

    if (start >= 0 && end >= start && end <= text.length) {
      validCitations.push({ start, end, source });
    }
  }

  // Sort positional citations from earliest to latest in the answer string
  validCitations.sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = 0;

  for (const item of validCitations) {
    if (item.start > cursor) {
      paragraph.append(document.createTextNode(text.slice(cursor, item.start)));
      cursor = item.start;
    }

    if (item.end > cursor) {
      paragraph.append(document.createTextNode(text.slice(cursor, item.end)));
      cursor = item.end;
    }

    paragraph.append(createInlineCitationLink(item.source));
  }

  if (cursor < text.length) {
    paragraph.append(document.createTextNode(text.slice(cursor)));
  }

  return orderedSources;
}

// Append a user or assistant message bubble (and any verified web sources) to the chat
function addMessage(role, rawText, citations = []) {
  const message = document.createElement("div");
  message.classList.add("message", role);

  const content = document.createElement("div");
  content.className = "message-content";

  const sender = document.createElement("span");
  sender.className = "message-sender";
  sender.setAttribute("dir", "ltr");
  sender.textContent = role === "user" ? "YOU" : "BEAUTY ASSISTANT";

  const paragraph = document.createElement("p");
  paragraph.setAttribute("dir", "auto");

  let sources = [];
  if (role === "ai" && Array.isArray(citations) && citations.length > 0) {
    sources = renderMessageWithCitations(paragraph, rawText, citations);
  } else {
    paragraph.textContent = String(rawText ?? "").trim();
  }

  content.append(sender, paragraph);

  if (sources.length > 0) {
    const sourcesBox = document.createElement("div");
    sourcesBox.className = "message-sources";
    sourcesBox.setAttribute("dir", "ltr");

    const sourcesLabel = document.createElement("span");
    sourcesLabel.className = "message-sources-label";
    sourcesLabel.textContent = "Sources";

    const sourcesList = document.createElement("ul");
    sourcesList.className = "message-sources-list";

    for (const source of sources) {
      const listItem = document.createElement("li");
      const link = document.createElement("a");
      link.className = "message-source-link";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const sourceTitle = source.title || source.hostname;
      link.append(
        document.createTextNode(`[${source.number}] ${sourceTitle} — ${source.hostname}`)
      );

      listItem.append(link);
      sourcesList.append(listItem);
    }

    sourcesBox.append(sourcesLabel, sourcesList);
    content.append(sourcesBox);
  }

  message.append(content);
  messages.append(message);
}

// Shared async function used by both typed chat questions and Generate Routine
async function sendChatRequest({
  displayText,
  apiText = displayText,
  restoreInputOnError = false,
  useWebSearch = false,
}) {
  const trimmedApiText = apiText.trim();
  if (!trimmedApiText || isRequestInProgress) return;

  const userMessage = { role: "user", content: trimmedApiText };

  // Show the user's message and update the latest question callout
  addMessage("user", displayText);
  latestQuestionText.textContent = displayText;
  latestQuestion.hidden = false;
  messages.append(latestQuestion);

  isRequestInProgress = true;
  updateActionButtons();
  chatStatus.textContent = useWebSearch
    ? "Searching the web and thinking…"
    : "Beauty Assistant is thinking…";
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    const requestPayload = {
      messages: [...chatHistory, userMessage],
    };

    if (useWebSearch) {
      requestPayload.webSearch = true;
    }

    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const data = await response.json();
    const rawReply =
      typeof data.answer === "string"
        ? data.answer
        : data.choices?.[0]?.message?.content || "";
    const reply = rawReply.trim();

    if (!response.ok || !reply) {
      throw new Error(
        data.error?.message || `Worker response: ${response.status}`
      );
    }

    const returnedCitations = Array.isArray(data.citations) ? data.citations : [];
    const safeCitations = returnedCitations.filter((citation) =>
      Boolean(getSafeHttpUrl(citation?.url))
    );

    // Save both turns in chatHistory so follow-ups can reference earlier answers
    chatHistory.push(userMessage, { role: "assistant", content: reply });
    addMessage("ai", rawReply, safeCitations);

    if (useWebSearch && safeCitations.length === 0) {
      chatStatus.textContent =
        "Web search returned no citations for this answer.";
    } else {
      chatStatus.textContent = "";
    }
  } catch (error) {
    console.error("Chat request failed:", error);
    chatStatus.textContent = useWebSearch
      ? "Web search failed. Please try again."
      : "Couldn’t get a reply. Please try again.";
    if (restoreInputOnError && !userInput.value) {
      userInput.value = displayText;
    }
  } finally {
    isRequestInProgress = false;
    updateActionButtons();
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

// Build catalog context from only the selected products and generate a routine
async function handleGenerateRoutine() {
  const selectedProducts = getSelectedProducts();
  if (selectedProducts.length === 0 || isRequestInProgress) return;

  // Include only available name, brand, category, and description fields
  const selectedCatalogContext = selectedProducts.map((product) => {
    const record = {};
    if (product.name) record.name = product.name;
    if (product.brand) record.brand = product.brand;
    if (product.category) record.category = product.category;
    if (product.description) record.description = product.description;
    return record;
  });

  const selectedNames = selectedCatalogContext
    .map((item) => `${item.brand ? `${item.brand} ` : ""}${item.name}`)
    .join(", ");

  const displayText = `Generate a personalized routine using my selected products: ${selectedNames}.`;

  const apiText = [
    "Build a personalized beauty routine using ONLY the selected products provided below as your catalog context.",
    "Base your steps and product details strictly on these records (name, brand, category, and description).",
    "Do not invent products, brand claims, SPF ratings, or ingredients that are not stated in the selected product records.",
    "If any typical routine steps or categories are missing for a complete routine, clearly explain those gaps without inventing or recommending unlisted products.",
    "Reply in plain text using a numbered list for the routine.",
    `Selected products: ${JSON.stringify(selectedCatalogContext)}`,
  ].join(" ");

  chatWindow.scrollIntoView({ behavior: "smooth", block: "nearest" });

  await sendChatRequest({
    displayText,
    apiText,
    restoreInputOnError: false,
    useWebSearch: false,
  });
}

// Search and category filters update the product grid while keeping selections
productSearch.addEventListener("input", () => {
  renderProductGrid();
});

categoryFilter.addEventListener("change", () => {
  renderProductGrid();
});

// Handle Select button clicks inside the product grid
productGrid.addEventListener("click", (event) => {
  const selectButton = event.target.closest(".product-select-btn");
  if (!selectButton) return;

  toggleProductSelection(selectButton.dataset.productId);
});

// Handle individual Remove button clicks inside Selected Products
selectedList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-selected-btn");
  if (!removeButton) return;

  removeProductSelection(removeButton.dataset.productId);
});

// Clear All button
clearSelectedButton.addEventListener("click", () => {
  clearAllSelections();
});

// Generate Routine button
generateRoutineButton.addEventListener("click", () => {
  handleGenerateRoutine();
});

// Suggested question pills pre-fill the chat input
document.querySelectorAll(".suggestion-btn").forEach((button) => {
  button.addEventListener("click", () => {
    userInput.value = button.dataset.prompt;
    userInput.focus();
  });
});

// Chat form submission reuses the shared request function
chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = userInput.value.trim();
  if (!question || isRequestInProgress) return;

  userInput.value = "";

  await sendChatRequest({
    displayText: question,
    apiText: question,
    restoreInputOnError: true,
    useWebSearch: webSearchToggle.checked,
  });
});

// Toggle between LTR and RTL page layout while keeping filters and selections intact
function applyLayoutDirection(isRtl) {
  document.documentElement.setAttribute("dir", isRtl ? "rtl" : "ltr");
  rtlToggle.setAttribute("aria-checked", isRtl ? "true" : "false");
}

rtlToggle.addEventListener("change", () => {
  applyLayoutDirection(rtlToggle.checked);
});

// Initialize layout direction and load product catalog on page load
applyLayoutDirection(rtlToggle.checked);
loadProducts();
