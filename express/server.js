import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import crypto from "crypto";
import sharp from "sharp";

dotenv.config();

import { PrismaClient } from "@prisma/client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const app = express();
const prisma = new PrismaClient();

const bucket_name = process.env.BUCKET_NAME;
const bucket_region = process.env.BUCKET_REGION;
const access_key = process.env.ACCESS_KEY;
const secret_access_key = process.env.SECRET_ACCESS_KEY;

const randomImageName = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex");

const s3 = new S3Client({
  credentials: {
    accessKeyId: access_key,
    secretAccessKey: secret_access_key,
  },
  region: bucket_region,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.get("/api/posts", async (req, res) => {
  const posts = await prisma.posts.findMany({ orderBy: [{ created: "desc" }] });

  for (const post of posts) {
    const getObjectParams = {
      Bucket: bucket_name,
      Key: post.imageName,
    };
    const command = new GetObjectCommand(getObjectParams);
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    post.imageUrl = url;
  }

  res.send(posts);
});

app.post("/api/posts", upload.single("image"), async (req, res) => {
  console.log("post image", req.body);
  console.log("file obj", req.file);

  const buffer = await sharp(req.file.buffer)
    .resize({ fit: "contain", height: 1920, width: 1080 })
    .toBuffer(); // some image processing just to make dimensions similar to instagram images

  const imageName = randomImageName(); // to prevent image overriden for same image selection inside s3, we're creating uniquename everytime

  const params = {
    Bucket: bucket_name,
    Key: imageName,
    Body: buffer,
    ContentType: req.file.mimetype,
  };

  const command = new PutObjectCommand(params);

  await s3.send(command);

  const post = await prisma.posts.create({
    data: {
      caption: req.body.caption,
      imageName,
    },
  });

  res.send(post);
});

app.delete("/api/posts/:id", async (req, res) => {
  const id = +req.params.id;
  const post = await prisma.posts.findUnique({ where: { id } });
  if (!post) {
    res.status(404).send("Post not found");
    return;
  }

  const params = {
    Bucket: bucket_name,
    Key: post.imageName,
  };
  const command = new DeleteObjectCommand(params);
  await s3.send(command);

  await prisma.posts.delete({ where: { id } });

  res.send(post);
});

app.listen(8080, () => console.log("listening on port 8080"));
