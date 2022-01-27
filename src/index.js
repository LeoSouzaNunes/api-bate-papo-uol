import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";

dotenv.config();
const app = express();

app.use(express.json());
app.use(cors());

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
    const participant = { name: req.body.name, lastStatus: Date.now() };
    const introMessage = {
        from: req.body.name,
        to: "Todos",
        text: "entra na sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
    };
    const [connectionParticipant, collectionParticipant] = await connectToCollection(
        "participants"
    );
    const [connectionMessage, collectionMessage] = await connectToCollection("messages");

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
    const [connectionParticipants, collectionParticipants] = await connectToCollection(
        "participants"
    );

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
    const message = {
        from: req.headers.user,
        to: req.body.to,
        text: req.body.text,
        type: req.body.type,
        time: dayjs().format("HH:mm:ss"),
    };

    const [connectionMessage, collectionMessage] = await connectToCollection("messages");

    try {
        await collectionMessage.insertOne(message);
        res.sendStatus(201);
        connectionMessage.close();
    } catch (error) {
        console.log("Error at the POST in /messages route", error);
        connectionMessage.close();
    }
});

app.listen(5000, () => console.log("Running at http://localhost:5000"));
