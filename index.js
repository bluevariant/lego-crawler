const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const Queue = require("better-queue");
const path = require("path");

async function main() {
  let baseUrl = "https://rebrickable.com";

  let { data } = await axios.get(baseUrl + "/parts/technic-beams/?format=table&page=1");
  let $ = cheerio.load(data);
  let baseData = [];
  $("tr").each((i, e) => {
    let td = $(e).find("td");
    if (td.length !== 3) return;
    let id = processId($(td[1]).text());
    if (id === undefined) return;
    let label = $(td[2]).text();
    let link = baseUrl + $($(td[0]).find("a")[0]).attr("href");
    baseData.push({ id, label, link });
  });
  let downloadTask = new Queue(
    async (params, cb) => {
      let saveToDir = path.join(__dirname, "dataset", params.id);
      await fs.ensureDir(saveToDir);
      let { data } = await axios.get(params.link);
      let $ = cheerio.load(data);
      let urls = [];
      $("img").each((i, e) => {
        let src = $(e).attr("data-src");
        if (src && src.includes("250x250") && src.includes("/media/thumbs/parts/")) {
          urls.push(src);
        }
      });
      Promise.all(
        urls.map((url) => {
          return new Promise(async (rel, rej) => {
            let splitUrl = url.split("/");
            name = splitUrl[splitUrl.length - 2];
            let saveTo = path.join(saveToDir, name);
            if (await fs.pathExists(saveTo)) {
              rel();
              console.log("Existed:", saveTo);
              return;
            }
            downloadImage(url, saveTo)
              .then(() => {
                console.log("Downloading done:", saveTo);
                rej();
              })
              .catch((e) => {
                console.error("Downloading failed:", url, e.message);
                rej(e);
              });
          });
        })
      )
        .then((v) => cb(null))
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

main().catch(console.error);
