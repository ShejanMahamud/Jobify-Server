const express = require("express");
require("dotenv").config();
const port = process.env.PORT || 3473;
const mongoURI = process.env.MONGO_URI;
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

//app
const app = express();

//middlewares
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
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
    // await client.connect();

    const jobsCollection = client.db("jobify").collection("jobs");
    const companiesCollection = client.db("jobify").collection("companies");

    app.get("/jobs", async (req, res) => {
      const result = await jobsCollection.find().toArray();
      res.send(result);
    });

    app.get('/jobs_count',async(req,res)=>{
      const result = await jobsCollection.countDocuments()
      res.send({jobsCount: result})
    })

    app.get("/search", async (req, res) => {
      const { title, location } = req.query;
      let page = parseInt(req?.query?.page);
      const limit = parseInt(req?.query?.limit)
      page = Math.max(page,1)
      const skip = (page -1) * limit;
      console.log(skip,page-1,limit)
      if (title?.length < 3 || location?.length < 3 ) {
        return res.status(400).send("Title must have at least 3 characters");
      }
      const query = { job_title: { $regex: title || '', $options: "i" },location: {$regex: location || '',$options: "i"} };
      const result = await jobsCollection.find(query).skip(skip).limit(limit).toArray();
      res.send(result);
    });

    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(filter);
      res.send(result);
    });

    app.get("/company", async (req, res) => {
      const { name } = req.query;
      console.log(name);
      const query = { company_name: name };
      const result = await companiesCollection.findOne(query);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
};

run().catch(console.log);

app.get("/", (req, res) => {
  res.send("Server Running...");
});

app.listen(port, () => {
  console.log("Server running on", port);
});
