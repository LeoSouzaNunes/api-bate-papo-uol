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

async function findUsername(username) {
    const [connectionParticipants, collectionParticipants] = await connectToCollection("participants");

    const user = await collectionParticipants.findOne({ name: username });

    if (!user) {
        connectionParticipants.close();
        return "Not found";
    } else {
        connectionParticipants.close();
        return user;
    }
}

async function removeInactiveUsers() {
    const [connectionParticipants, collectionParticipants] = await connectToCollection("participants");
    const [connectionMessages, collectionMessages] = await connectToCollection("messages");
    const condition = Date.now() - 10000;

    try {
        const offlineUsers = await collectionParticipants.find({ lastStatus: { $lt: condition } }).toArray();

        await offlineUsers.forEach(async (offlineUser) => {
            try {
                await collectionMessages.insertOne({
                    from: offlineUser.name,
                    to: "Todos",
                    text: "sai da sala...",
                    type: "status",
                    time: dayjs().format("HH:mm:ss"),
                });
            } catch (error) {
                console.log(error);
            }
        });

        await collectionParticipants.deleteMany({ lastStatus: { $lt: condition } });
        return;
    } catch (error) {
        console.log("Error at removeInactiveUsers function");
    }
    connectionParticipants.close();
    connectionMessages.close();
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
        res.status(200).send(participants);
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

    if ((await findUsername(req.headers.user)) === "Not found") {
        res.status(422).send("Username not found");
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

    const messagesLimit = req.query.limit;
    const [connectionMessages, collectionMessages] = await connectToCollection("messages");

    if ((await findUsername(username)) === "Not found") {
        res.status(404).send("Username not found");
        connectionMessages.close();
        return;
    }

    try {
        const messages = await collectionMessages
            .find({
                $or: [
                    { type: "status" },
                    { type: "message" },
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

app.post("/status", async (req, res) => {
    const username = req.headers.user;
    const user = await findUsername(username);
    if (user === "Not found") {
        res.sendStatus(404);
        return;
    }

    const [connectionParticipant, collectionParticipant] = await connectToCollection("participants");

    try {
        await collectionParticipant.updateOne(
            {
                _id: user._id,
            },
            { $set: { ...user, lastStatus: Date.now() } }
        );

        connectionParticipant.close();
        res.sendStatus(200);
    } catch (error) {
        console.log("Error at the POST in /status route", error);
        connectionParticipant.close();
    }
});

setInterval(async () => {
    await removeInactiveUsers();
}, 15000);

app.listen(5000, () => console.log("Running at http://localhost:5000"));
