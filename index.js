const express = require("express");
require("dotenv").config();
const port = process.env.PORT || 3473;
const mongoURI = process.env.MONGO_URI;
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const secret_token = process.env.ACCESS_TOKEN_SECRET;

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
app.use(cookieParser());

//mongo client
const client = new MongoClient(mongoURI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//middlewares (custom)
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(403).send("Forbidden Access!");
  }
  jwt.verify(token, secret_token, (error, decoded) => {
    if (error) {
      return res.status(403).send("Forbidden Access!");
    }
    req.user = decoded;
    next();
  });
};

const run = async () => {
  try {
    // await client.connect();

    const jobsCollection = client.db("jobify").collection("jobs");
    const companiesCollection = client.db("jobify").collection("companies");
    const usersCollection = client.db("jobify").collection("users");
    const appliedJobsCollection = client.db("jobify").collection("appliedJobs");
    const bookmarkJobsCollection = client.db("jobify").collection("bookmarkJobs");

    app.get("/jobs", async (req, res) => {
      let query = {};
      if (req.query.related && req.query.id) {
        query = {
          category: req.query.related,
          _id: { $ne: new ObjectId(req.query.id) },
        };
      }
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/jobs_count", async (req, res) => {
      const result = await jobsCollection.countDocuments();
      res.send({ jobsCount: result });
    });

    app.get("/search", async (req, res) => {
      const { title, location, type } = req.query;
      let page = parseInt(req?.query?.page);
      const limit = parseInt(req?.query?.limit);
      page = Math.max(page, 1);
      const skip = (page - 1) * limit;
      if (title?.length < 3 || location?.length < 3 || type?.length < 3) {
        return res
          .status(400)
          .send("Title, location, and type must have at least 3 characters");
      }
      const query = {
        job_title: { $regex: title || "", $options: "i" },
        location: { $regex: location || "", $options: "i" },
        job_type: { $regex: type || "", $options: "i" },
      };
      const result = await jobsCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();
      res.send(result);
    });

    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(filter);
      res.send(result);
    });

    app.get("/company/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await companiesCollection.findOne(query);
      res.send(result);
    });

    app.get("/open_jobs", async (req, res) => {
      const name = req.query?.name;
      const query = { company_name: name };
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    app.get('/applied_jobs',async(req,res)=>{
      let query = {};
      if(req.query.email){
        query = {candidate_email: req.query.email}
      }
      const appliedJobs = await appliedJobsCollection.find(query).toArray();
      const jobIds = appliedJobs.map(job => job.jobId)
      const jobDetails = await jobsCollection.find({ _id: { $in: jobIds.map(id => new ObjectId(id)) } }).toArray();
      const appliedJobsWithDetails = appliedJobs.map(appliedJob => {
        const jobDetail = jobDetails.find(job => job._id.toString() === appliedJob.jobId);
        return { ...appliedJob, jobDetail };
      });
      res.send(appliedJobsWithDetails)
    })

    app.get('/bookmark_jobs',async(req,res)=>{
      let query = {};
      if(req.query.email){
        query = {candidate_email: req.query.email}
      }
      const result = await bookmarkJobsCollection.find(query).toArray();
      res.send(result)
    })

    app.get("/companies", async (req, res) => {
      const page = parseInt(req.query?.page) - 1;
      const size = parseInt(req.query?.size);
      const name = req.query?.name;
      let query = {};
      if (name) {
        query = { company_name: name };
      }
      const result = await companiesCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get("/company_search", async (req, res) => {
      const count = await companiesCollection.countDocuments();
      res.send({ count });
    });
    //will delete later this
    app.get("/user/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user?.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access!" });
      }
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    //will keep this
    app.get("/login/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      const { role } = result;
      res.send({ role: role });
    });

    // Clear token on logout
    app.get("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 0,
        })
        .send({ success: true });
    });

    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.post("/auth", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, secret_token, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.post("/apply", async (req, res) => {
      const jobInfo = req.body;

      const existingApplication = await appliedJobsCollection.findOne({
        jobId: jobInfo.jobId,
        candidate_email: jobInfo.candidate_email,
      });
      if (existingApplication) {
        return res.send({ duplicate: true });
      }

      const result = await appliedJobsCollection.insertOne(jobInfo);
      res.send(result);
    });

    app.post("/bookmark_jobs", async (req, res) => {
      const jobInfo = req.body;

      const existingBookmark = await bookmarkJobsCollection.findOne({
        jobId: jobInfo.jobId,
        candidate_email: jobInfo.candidate_email,
      });
      if (existingBookmark) {
        return res.send({ success: false });
      }

      const result = await bookmarkJobsCollection.insertOne(jobInfo);
      res.send({result:result,success:true});
    });

    app.patch('/user/:email',async(req,res)=>{
      const user = req.body;
      const query = {email: req.params.email}
      const option = {upsert:true}
      const updatedUser = {
        $set:{
          name: user.name,
          title: user.title,
          education: user.education,
          website: user.website,
          resume: user.resume,
          photo: user.photo,
          experience: user.experience
        }
      }
      const result = await usersCollection.findOneAndUpdate(query,updatedUser);
      res.send({success:true})
    })

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
