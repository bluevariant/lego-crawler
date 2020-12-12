const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const Queue = require("better-queue");
const path = require("path");
const _ = require("lodash");

const BASE_URL = "https://rebrickable.com";
let DIRNAME;
// Colab
let driveDir = "../drive/MyDrive";
if (fs.existsSync(driveDir)) {
  DIRNAME = path.join(driveDir, "lego");
} else {
  DIRNAME = path.join(__dirname, "drive/MyDrive");
}
fs.ensureDirSync(DIRNAME);
const DOWNLOADED_FILE = path.join(DIRNAME, "downloaded.json");
fs.ensureFileSync(DOWNLOADED_FILE);

const downloaded = JSON.parse(fs.readFileSync(DOWNLOADED_FILE, "utf-8") || "{}");

async function main() {
  let categories = [
    "parts/bricks",
    "parts/technic-beams",
    "parts/technic-bricks",
    "parts/technic-connectors",
    "parts/technic-gears",
    "parts/technic-panels",
    "parts/technic-special",
    "parts/technic-steering-suspension-and-engine",
  ];
  for (let i = 0; i < categories.length; i++) {
    await crawlPhotos(categories[i]);
    console.log("Done:", categories[i]);
  }
  console.log("OK");
}

async function crawlPhotos(category) {
  // category = "/parts/technic-beams/"
  if (!category.startsWith("/")) category = "/" + category;
  if (!category.endsWith("/")) category += "/";
  if (category.includes("?")) {
    category = category.split("?")[0];
  }
  let { data } = await axios.get(BASE_URL + category + "?format=table");
  let $ = cheerio.load(data);
  let baseData = [];
  $("tr").each((i, e) => {
    let td = $(e).find("td");
    if (td.length !== 3) return;
    let realId = $(td[1]).text();
    let partId = processId(realId);
    if (partId === undefined) return;
    let label = $(td[2]).text();
    let link = BASE_URL + $($(td[0]).find("a")[0]).attr("href");
    baseData.push({ partId, realId, label, link });
  });
  // fs.writeFileSync("base_data.json", JSON.stringify(baseData, null, 2));
  let downloadTask = new Queue(
    async (params, cb) => {
      let saveToDir = path.join(DIRNAME, "dataset", params.partId);
      await fs.ensureDir(saveToDir);
      // if (params.partId === "3005") console.log(params.link);
      if (downloaded[params.link]) {
        console.log("Downloaded:", params.link);
        return cb(null);
      }
      let { data } = await axios.get(params.link);
      let $ = cheerio.load(data);
      let urls = [];
      $("img").each((i, e) => {
        let src = $(e).attr("data-src");
        // if (params.partId === "3005" && src && src.includes("/media/thumbs/parts/")) {
        //   console.log(src);
        // }
        if (src && src.includes("250x250") && src.includes("/media/thumbs/parts/")) {
          urls.push(src);
        }
      });
      // fs.writeFileSync("images.json", JSON.stringify(urls, null, 2));
      Promise.all(
        urls.map((url) => {
          return new Promise(async (rel, rej) => {
            let splitUrl = url.split("/");
            name = splitUrl[splitUrl.length - 2];
            let saveTo = path.join(saveToDir, name);
            if (await fs.pathExists(saveTo)) {
              console.log("Existed:", params.partId, saveTo);
              fs.writeFile(saveTo + ".txt", [category, params.partId, params.realId, params.label, params.link].join("\r\n"))
                .then(rel)
                .catch(rel);
              return;
            }
            downloadImage(url, saveTo)
              .then(() => {
                console.log("Downloading done:", params.partId, saveTo);
                fs.writeFile(saveTo + ".txt", [category, params.partId, params.realId, params.label, params.link].join("\r\n"))
                  .then(rel)
                  .catch(rel);
              })
              .catch((e) => {
                console.error("Downloading failed:", params.partId, url, e.message);
                rej(e);
              });
          });
        })
      )
        .then((v) => {
          downloaded[params.link] = true;
          updateDownloaded().then(() => cb(null, v));
        })
        .catch((e) => cb(e));
    },
    { concurrent: 5, maxRetries: 3 }
  );
  await Promise.all(
    baseData.map((v) => {
      return new Promise((rel, rej) => {
        downloadTask.push(v, (err, result) => {
          if (err) rej(err);
          else rel(result);
        });
      });
    })
  );
  // Remove empty folder
  _.forEach(fs.readdirSync(path.join(DIRNAME, "dataset")), (dir) => {
    try {
      fs.rmdirSync(path.join(DIRNAME, "dataset", dir));
      console.log("Remove empty:", dir);
    } catch (e) {}
  });
}

function processId(text) {
  if (+text >= 0) return text;
  let match = "0123456789";
  let result = undefined;
  text = text.split("");
  for (let i = 0; i < text.length; i++) {
    if (!match.includes(text[i])) break;
    if (result === undefined) result = "";
    result += text[i];
  }
  return result;
}

let downloadImageTask = new Queue(
  ({ url, imagePath }, cb) => {
    axios({
      url,
      responseType: "stream",
    })
      .then((res) => {
        res.data
          .pipe(fs.createWriteStream(imagePath))
          .on("finish", () => cb(null))
          .on("error", async (e) => {
            if (await fs.pathExists(imagePath)) {
              await fs.unlink(imagePath);
            }
            cb(e);
          });
      })
      .catch((e) => cb(e));
  },
  { concurrent: 10, maxRetries: 5, retryDelay: 1000 }
);

function downloadImage(url, imagePath) {
  return new Promise((rel, rej) => {
    downloadImageTask.push({ url, imagePath }, (err) => {
      if (err) rej(err);
      else rel();
    });
  });
}

let updateDownloadedTask = new Queue(
  (params, cb) => {
    fs.writeFile(DOWNLOADED_FILE, JSON.stringify(downloaded, null, 2))
      .then(() => cb(null))
      .catch(() => cb(null));
  },
  { concurrent: 1 }
);

function updateDownloaded() {
  return new Promise((rel) => {
    updateDownloadedTask.push({}, rel);
  });
}

main().catch(console.error);
