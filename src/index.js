import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import joi from "joi";

dotenv.config();
const app = express();

app.use(express.json());
app.use(cors());

const usernameSchema = joi.object({
    name: joi.string().required(),
});

const messageSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi
        .string()
        .pattern(/(message)|(private_messsage)/)
        .required(),
});

async function connectToCollection(collectionName) {
    const mongoClient = new MongoClient(process.env.MONGO_URI);

    try {
        const connection = await mongoClient.connect();
        const collection = connection.db("api-batepapo-uol").collection(collectionName);

        return [connection, collection];
    } catch (error) {
        console.log("connectMongo has some issues...", error);
    }
}

app.post("/participants", async (req, res) => {
    const validation = usernameSchema.validate(req.body, { abortEarly: true });

    if (validation.error) {
        res.status(422).send(validation.error.details[0].message);
        return;
    }

    const participant = { name: req.body.name, lastStatus: Date.now() };
    const introMessage = {
        from: req.body.name,
        to: "Todos",
        text: "entra na sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
    };
    const [connectionParticipant, collectionParticipant] = await connectToCollection("participants");
    const [connectionMessage, collectionMessage] = await connectToCollection("messages");

    const isRepeated = await collectionParticipant.findOne(req.body);

    if (isRepeated) {
        res.status(409).send("Name already in use by someone else");
        connectionParticipant.close();
        connectionMessage.close();
        return;
    }

    try {
        await collectionMessage.insertOne(introMessage);
        await collectionParticipant.insertOne(participant);
        res.sendStatus(201);
        connectionParticipant.close();
        connectionMessage.close();
    } catch (error) {
        console.log("Error at the POST in /participants route", error);
        connectionParticipant.close();
        connectionMessage.close();
    }
});

app.get("/participants", async (req, res) => {
    const [connectionParticipants, collectionParticipants] = await connectToCollection("participants");

    try {
        const participants = await collectionParticipants.find({}).toArray();
        res.send(participants);
        connectionParticipants.close();
    } catch (error) {
        console.log("Error at the GET in /participants route", error);
        connectionParticipants.close();
    }
});

app.post("/messages", async (req, res) => {
    const validation = messageSchema.validate(req.body, { abortEarly: true });

    if (validation.error) {
        res.status(422).send(validation.error.details[0].message);
        return;
    }

    const message = {
        from: req.headers.user,
        to: req.body.to,
        text: req.body.text,
        type: req.body.type,
        time: dayjs().format("HH:mm:ss"),
    };

    const [connectionMessage, collectionMessage] = await connectToCollection("messages");
    const [connectionParticipants, collectionParticipants] = await connectToCollection("participants");

    const userNotFound = await collectionParticipants.findOne({ name: req.headers.user });

    if (!userNotFound) {
        res.status(422).send("Username not found");
        connectionParticipants.close();
        connectionMessage.close();
        return;
    }

    try {
        await collectionMessage.insertOne(message);
        res.sendStatus(201);
        connectionMessage.close();
    } catch (error) {
        console.log("Error at the POST in /messages route", error);
        connectionMessage.close();
    }
});

app.get("/messages", async (req, res) => {
    const username = req.headers.user;
    console.log(username);
    const messagesLimit = req.query.limit;
    const [connectionMessages, collectionMessages] = await connectToCollection("messages");

    try {
        const messages = await collectionMessages
            .find({
                $or: [
                    { to: "Todos" },
                    { from: username, type: "private_message" },
                    { to: username, type: "private_message" },
                ],
            })
            .toArray();

        if (!messagesLimit || messagesLimit <= 0) {
            res.send(messages);
            connectionMessages.close();
            return;
        }

        res.send([...messages].reverse().slice(0, messagesLimit).reverse());
        connectionMessages.close();
    } catch (error) {
        console.log("Error at the POST in /messages route", error);
        connectionMessages.close();
    }
});

app.listen(5000, () => console.log("Running at http://localhost:5000"));
