const express = require("express");
require("dotenv").config();
const port = process.env.PORT || 3473;
const mongoURI = process.env.MONGO_URI;
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

//app
const app = express();

//middlewares
app.use(cors({
    origin: ['http://localhost:5173'],
    credentials: true,
}));
app.use(express.json());

//mongo client
const client = new MongoClient(mongoURI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    await client.connect();

    const jobsCollection = client.db('jobify').collection('jobs');

    app.get('/jobs',async (req,res) => {
        const result = await jobsCollection.find().toArray();
        res.send(result)
    })

    app.get('/search',async(req,res)=>{
        const {title} = req.query;
        if (title.length < 3) {
            return res.status(400).send("Title must have at least 3 characters");
        }
        const query = { title: { $regex: title, $options: 'i' } };
        const result = await jobsCollection.find(query).toArray();
        res.send(result)
    })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
};

run().catch(console.log)

app.get('/',(req,res)=>{
    res.send('Server Running...')
})

app.listen(port,()=>{
    console.log('Server running on',port)
})