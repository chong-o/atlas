const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog } = require("electron");
const { mergeDataDirectory } = require("./data-migration");

let localServer;
let mainWindow;

async function createWindow() {
  app.setName("Right or Chong?");
  const appDataRoot = app.getPath("appData");
  const appDataDirectory = path.join(appDataRoot, "Atlas");
  const dataDirectory = path.join(appDataDirectory, "data");

  try {
    await fs.mkdir(appDataDirectory, { recursive: true });
    app.setPath("userData", appDataDirectory);
    process.env.ATLAS_DATA_DIR = dataDirectory;
    await mergeDataDirectory(path.join(appDataRoot, "atlas-image-quiz", "data"), dataDirectory);
    if (!app.isPackaged) {
      await mergeDataDirectory(path.join(__dirname, "data"), dataDirectory);
    }
    const { start } = require("./server");
    localServer = await start({ port: 0, log: false });
  } catch (error) {
    dialog.showErrorBox("Right or Chong? could not start", `Right or Chong? was unable to open its local data store.\n\n${error.message}`);
    app.quit();
    return;
  }

  const address = localServer.address();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 600,
    title: "Right or Chong?",
    backgroundColor: "#f7f7f2",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${address.port}/`) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  try {
    await mainWindow.loadURL(`http://127.0.0.1:${address.port}/`);
  } catch (error) {
    dialog.showErrorBox("Right or Chong? could not open", `The Right or Chong? window could not be loaded.\n\n${error.message}`);
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (localServer) localServer.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
