import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import joi from "joi";
import { stripHtml } from "string-strip-html";

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
    const nameObject = {
        name: stripHtml(req.body.name).result.trim(),
    };

    const validation = usernameSchema.validate(nameObject, { abortEarly: true });

    if (validation.error) {
        res.status(422).send(validation.error.details[0].message);
        return;
    }

    const participant = { name: nameObject.name, lastStatus: Date.now() };
    const introMessage = {
        from: nameObject.name,
        to: "Todos",
        text: "entra na sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
    };
    const [connectionParticipant, collectionParticipant] = await connectToCollection("participants");
    const [connectionMessage, collectionMessage] = await connectToCollection("messages");

    const isRepeated = await collectionParticipant.findOne(nameObject);

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
    const username = stripHtml(req.headers.user).result.trim();
    const requestObject = {
        to: stripHtml(req.body.to).result.trim(),
        text: stripHtml(req.body.text).result.trim(),
        type: stripHtml(req.body.type).result.trim(),
    };

    const messageObject = {
        from: username,
        to: stripHtml(req.body.to).result.trim(),
        text: stripHtml(req.body.text).result.trim(),
        type: stripHtml(req.body.type).result.trim(),
        time: dayjs().format("HH:mm:ss"),
    };

    const validation = messageSchema.validate(requestObject, { abortEarly: true });

    if (validation.error) {
        res.status(422).send(validation.error.details[0].message);
        return;
    }

    const [connectionMessage, collectionMessage] = await connectToCollection("messages");

    if ((await findUsername(username)) === "Not found") {
        res.status(422).send("Username not found");
        connectionMessage.close();
        return;
    }

    try {
        await collectionMessage.insertOne(messageObject);
        res.sendStatus(201);
        connectionMessage.close();
    } catch (error) {
        console.log("Error at the POST in /messages route", error);
        connectionMessage.close();
    }
});

app.get("/messages", async (req, res) => {
    const username = stripHtml(req.headers.user).result.trim();

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
    const username = stripHtml(req.headers.user).result.trim();
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

app.delete("/messages/:messageId", async (req, res) => {
    const username = stripHtml(req.headers.user).result.trim();
    const id = req.params.messageId;

    const [connectionMessages, collectionMessages] = await connectToCollection("messages");

    try {
        const message = await collectionMessages.findOne({ _id: new ObjectId(id) });

        if (!message) {
            res.sendStatus(404);
            connectionMessages.close();
            return;
        }

        if (message.from !== username) {
            res.sendStatus(401);
            connectionMessages.close();
            return;
        }

        await collectionMessages.deleteOne({ _id: message._id });
        res.sendStatus(200);
        connectionMessages.close();
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
        connectionMessages.close();
    }
});

app.put("/messages/:messageId", async (req, res) => {
    const username = stripHtml(req.headers.user).result.trim();
    const id = req.params.messageId;

    const requestObject = {
        to: stripHtml(req.body.to).result.trim(),
        text: stripHtml(req.body.text).result.trim(),
        type: stripHtml(req.body.type).result.trim(),
    };

    const messageObject = {
        from: username,
        to: stripHtml(req.body.to).result.trim(),
        text: stripHtml(req.body.text).result.trim(),
        type: stripHtml(req.body.type).result.trim(),
        time: dayjs().format("HH:mm:ss"),
    };

    const validation = messageSchema.validate(requestObject, { abortEarly: true });

    if (validation.error) {
        res.status(422).send(validation.error.details[0].message);
        return;
    }

    const [connectionMessages, collectionMessages] = await connectToCollection("messages");

    try {
        const message = await collectionMessages.findOne({ _id: new ObjectId(id) });

        if (!message) {
            res.sendStatus(404);
            connectionMessages.close();
            return;
        }

        if (message.from !== username) {
            res.sendStatus(401);
            connectionMessages.close();
            return;
        }

        await collectionMessages.updateOne({ _id: message._id }, { $set: { ...message, ...messageObject } });
        res.sendStatus(200);
        connectionMessages.close();
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
        connectionMessages.close();
    }
});

setInterval(async () => {
    await removeInactiveUsers();
}, 15000);

app.listen(5000, () => console.log("Running at http://localhost:5000"));
