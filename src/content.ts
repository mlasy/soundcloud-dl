import { DomObserver, ObserverEvent } from "./domObserver";
import { Logger } from "./logger";
import { sendMessageToBackend, onMessage } from "./compatibilityStubs";
import { registerConfigChangeHandler, loadConfiguration, getConfigValue } from "./config";
import { v4 as uuid } from "uuid";

type KeyedButtons = { [key: string]: HTMLButtonElement };
type OnButtonClicked = (downloadId: string) => Promise<any>;

let observer: DomObserver | null = null;
const logger = Logger.create("SoundCloud-Downloader");

const downloadButtons: KeyedButtons = {};

const handleMessageFromBackgroundScript = async (_, message: any) => {
  console.log("Progress of " + message.downloadId, message.progress);
};

onMessage(handleMessageFromBackgroundScript);

const createDownloadButton = () => {
  const button = document.createElement("button");
  button.className = "sc-button sc-button-download sc-button-medium sc-button-responsive";
  button.title = "Download";
  button.innerText = "Download";

  return button;
};

const addDownloadButtonToParent = (parent: Node & ParentNode, onClicked: OnButtonClicked) => {
  const downloadButtonExists = parent.querySelector("button.sc-button-download") !== null;

  if (downloadButtonExists) {
    logger.logDebug("Download button already exists");

    return;
  }

  const button = createDownloadButton();
  button.onclick = async () => {
    button.disabled = true;
    button.title = button.innerText = "Downloading...";

    const downloadId = uuid();

    downloadButtons[downloadId] = button;

    await onClicked(downloadId);
  };

  parent.appendChild(button);
};

const removeElementFromParent = (element: Element) => {
  element.parentNode.removeChild(element);
};

const removeElementsMatchingSelectors = (selectors: string) => {
  const elements = document.querySelectorAll(selectors);

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];

    removeElementFromParent(element);
  }
};

const removeBuyLinks = () => {
  const selector = "a.sc-buylink";

  removeElementsMatchingSelectors(selector);

  const event: ObserverEvent = {
    selector,
    callback: (node) => removeElementFromParent(node),
  };

  observer?.addEvent(event);
};

const removeDownloadButtons = () => {
  removeElementsMatchingSelectors("button.sc-button-download");
};

const createDownloadCommand = (url: string) => (downloadId: string) => {
  const set = url.includes("/sets/");

  return sendMessageToBackend({
    type: set ? "DOWNLOAD_SET" : "DOWNLOAD",
    url,
    downloadId,
  });
};

const addDownloadButtonToTrackPage = () => {
  const selector = ".sc-button-group-medium > .sc-button-like";

  // ugly inline func
  const addDownloadButtonToPossiblePlaylist = (node: Element) => {
    const downloadUrl = window.location.origin + window.location.pathname;

    const downloadCommand = createDownloadCommand(downloadUrl);

    addDownloadButtonToParent(node.parentNode, downloadCommand);
  };

  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);

  const event: ObserverEvent = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist,
  };

  observer?.addEvent(event);
};

const addDownloadButtonToFeed = () => {
  const selector = ".sound.streamContext .sc-button-group > .sc-button-like";

  // ugly inline func
  const addDownloadButtonToPossiblePlaylist = (node: Element) => {
    const soundBody = node.parentElement.closest(".sound__body");
    const titleLink = soundBody.querySelector("a.soundTitle__title");

    if (titleLink === null) {
      return;
    }

    const downloadUrl = window.location.origin + titleLink.getAttribute("href");

    const downloadCommand = createDownloadCommand(downloadUrl);

    addDownloadButtonToParent(node.parentNode, downloadCommand);
  };

  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);

  const event: ObserverEvent = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist,
  };

  observer?.addEvent(event);
};

const removeReposts = () => {
  const selector = ".soundContext__repost";

  const removeRepost = (node: Element) => {
    const listItem = node.closest(".soundList__item");

    if (!listItem) return;

    removeElementFromParent(listItem);
  };

  document.querySelectorAll(selector).forEach(removeRepost);

  const event: ObserverEvent = {
    name: "repost",
    selector,
    callback: removeRepost,
  };

  observer?.addEvent(event);
};

const handleBlockRepostsConfigChange = (blockReposts: boolean) => {
  if (blockReposts) {
    logger.logInfo("Start blocking reposts");

    removeReposts();
  } else {
    logger.logInfo("Stop blocking reposts");

    observer.removeEvent("repost");
  }
};

registerConfigChangeHandler("block-reposts", handleBlockRepostsConfigChange);

const handlePageLoaded = async () => {
  observer = new DomObserver();

  await loadConfiguration(true);

  if (getConfigValue("block-reposts")) handleBlockRepostsConfigChange(true);

  removeBuyLinks();

  removeDownloadButtons();

  addDownloadButtonToTrackPage();

  addDownloadButtonToFeed();

  observer.start(document.body);

  logger.logInfo("Attached!");
};

const documentState = document.readyState;

if (documentState === "complete" || documentState === "interactive") {
  setTimeout(handlePageLoaded, 0);
}

document.addEventListener("DOMContentLoaded", handlePageLoaded);

window.onbeforeunload = () => {
  observer?.stop();
  logger.logDebug("Unattached!");
};
