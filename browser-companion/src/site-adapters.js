const definitions = {
  chatgpt: {
    id: "chatgpt",
    hosts: ["chatgpt.com"],
    composer: ["#prompt-textarea", "textarea"],
    send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
    assistant: ['[data-message-author-role="assistant"]'],
    user: ['[data-message-author-role="user"]'],
  },
  deepseek: {
    id: "deepseek",
    hosts: ["chat.deepseek.com"],
    composer: ["textarea", '[contenteditable="true"]'],
    send: ['button[aria-label*="Send"]', 'button[aria-label*="发送"]'],
    assistant: [".ds-markdown", '[data-role="assistant"]', ".markdown-body"],
    user: ['[data-message-author-role="user"]', '[data-role="user"]'],
  },
  claude: {
    id: "claude",
    hosts: ["claude.ai"],
    composer: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"]'],
    send: ['button[aria-label*="Send"]', 'button[aria-label*="发送"]'],
    assistant: ['[data-testid="assistant-message"]', ".font-claude-response"],
    user: ['[data-testid="user-message"]', '[data-message-author-role="user"]'],
  },
  generic: {
    id: "generic",
    hosts: [],
    composer: [
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'main [contenteditable="true"]',
      "main textarea",
    ],
    send: [
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
      'button[aria-label*="发送"]',
      'button[title*="发送"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="assistant"] [class*="markdown"]',
      "main article",
    ],
    user: [
      '[data-message-author-role="user"]',
      '[data-role="user"]',
      'main [class*="user"]',
    ],
  },
};

export function detectAdapter(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return definitions.generic;
  }
  return (
    Object.values(definitions).find((entry) => entry.hosts.includes(hostname)) ??
    definitions.generic
  );
}

function firstVisible(document, selectors) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return element;
    }
  }
  return null;
}

export function findComposer(document, adapter) {
  return firstVisible(document, [...adapter.composer, ...definitions.generic.composer]);
}

export function findSendButton(document, adapter) {
  return firstVisible(document, [...adapter.send, ...definitions.generic.send]);
}

export function latestAssistantText(document, adapter) {
  const collect = (selectors) => {
    const elements = [];
    for (const selector of selectors) {
      elements.push(...document.querySelectorAll(selector));
    }
    return [...new Set(elements)].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };
  const specific = collect(adapter.assistant);
  const candidates = specific.length
    ? specific
    : collect(definitions.generic.assistant);
  return candidates.at(-1)?.innerText?.trim() ?? "";
}

export function latestUserText(document, adapter) {
  const collect = (selectors) => {
    const elements = [];
    for (const selector of selectors) {
      elements.push(...document.querySelectorAll(selector));
    }
    return [...new Set(elements)].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };
  const specific = collect(adapter.user);
  const candidates = specific.length
    ? specific
    : collect(definitions.generic.user);
  return candidates.at(-1)?.innerText?.trim() ?? "";
}

export function writeComposer(composer, text) {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(composer, text);
  } else if (composer instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(composer, text);
  } else {
    composer.textContent = text;
  }
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text,
    }),
  );
  composer.dispatchEvent(new Event("change", { bubbles: true }));
}

export function submitComposer(document, adapter, composer) {
  const button = findSendButton(document, adapter);
  if (button && !button.disabled) {
    button.click();
    return true;
  }
  composer.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  return false;
}

export const supportedAdapters = Object.values(definitions).map(
  ({ id, hosts }) => ({ id, hosts: [...hosts] }),
);
