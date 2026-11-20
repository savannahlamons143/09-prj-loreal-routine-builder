const WORKER_URL = "https://loreal-chatbot.sklamons2019.workers.dev/";

const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const messages = document.getElementById("messages");
const latestQuestion = document.getElementById("latestQuestion");
const latestQuestionText = document.getElementById("latestQuestionText");
const sendButton = document.getElementById("sendBtn");
const chatStatus = document.getElementById("chatStatus");

const chatHistory = [
  {
    role: "system",
    content:
      "You are the L’Oréal Beauty Assistant. Help users discover L’Oréal " +
      "makeup, skincare, haircare, fragrances, and beauty routines. " +
      "Use earlier turns to answer follow-up questions. Politely redirect " +
      "unrelated questions to beauty topics. Keep replies concise." + "Reply in plain text. Use numbered lists for routines and avoid Markdown styling. ",
  },
];

function addMessage(role, text) {
  const message = document.createElement("div");
  message.classList.add("message", role);

  const content = document.createElement("div");
  content.className = "message-content";

  const sender = document.createElement("span");
  sender.className = "message-sender";
  sender.textContent = role === "user" ? "YOU" : "BEAUTY ASSISTANT";

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  content.append(sender, paragraph);
  message.append(content);
  messages.append(message);
}

document.querySelectorAll(".suggestion-btn").forEach((button) => {
  button.addEventListener("click", () => {
    userInput.value = button.dataset.prompt;
    userInput.focus();
  });
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = userInput.value.trim();
  if (!question || sendButton.disabled) return;

  const userMessage = { role: "user", content: question };

  addMessage("user", question);
  latestQuestionText.textContent = question;
  latestQuestion.hidden = false;
  messages.append(latestQuestion);

  userInput.value = "";
  sendButton.disabled = true;
  chatStatus.textContent = "Beauty Assistant is thinking…";
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [...chatHistory, userMessage] }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!response.ok || !reply) {
      throw new Error(data.error?.message || `Worker response: ${response.status}`);
    }

    chatHistory.push(userMessage, { role: "assistant", content: reply });
    addMessage("ai", reply);
    chatStatus.textContent = "";
  } catch (error) {
    console.error("Chat request failed:", error);
    chatStatus.textContent = "Couldn’t get a reply. Please try again.";
    if (!userInput.value) userInput.value = question;
  } finally {
    sendButton.disabled = false;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
});
