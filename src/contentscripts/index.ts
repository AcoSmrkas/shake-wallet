import MessageTypes from "@src/util/messageTypes";

(async function () {
  const url = chrome.runtime.getURL("js/shake.js");
  const container = document.head || document.documentElement;
  const scriptTag = document.createElement("script");
  scriptTag.src = url;
  scriptTag.setAttribute("async", "false");
  container.insertBefore(scriptTag, container.children[0]);
  container.removeChild(scriptTag);

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (data && data.target === "shake-contentscript") {
      const res = await chrome.runtime.sendMessage(data.message);
      window.postMessage(
        {
          target: "shake-injectedscript",
          payload: res,
          nonce: data.nonce,
        },
        "*"
      );
    }
  });

  chrome.runtime.onMessage.addListener((action: any) => {
    switch (action.type) {
      case MessageTypes.DISCONNECTED:
        window.postMessage(
          {
            target: "shake-injectedscript",
            payload: [null, null],
            nonce: "disconnect",
          },
          "*"
        );
        return;
      case MessageTypes.NEW_BLOCK:
        window.postMessage(
          {
            target: "shake-injectedscript",
            payload: [null, action.payload],
            nonce: "newBlock",
          },
          "*"
        );
        return;
    }
  });
})();
