const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const port = process.env.PORT || 3473;
const mongoURI = process.env.MONGO_URI;
const secret_token = process.env.ACCESS_TOKEN_SECRET;

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
  origin: ["http://localhost:5173"],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// MongoDB client setup
const client = new MongoClient(mongoURI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Custom middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(403).send("Forbidden Access!");
  }
  jwt.verify(token, secret_token, (error, decoded) => {
    if (error) {
      return res.status(403).send("Forbidden Access!");
    }
    req.user = decoded;
    next();
  });
};

// Main function to run MongoDB client and set up routes
const run = async () => {
  try {
    await client.connect();

    const jobsCollection = client.db("jobify").collection("jobs");
    const companiesCollection = client.db("jobify").collection("companies");
    const usersCollection = client.db("jobify").collection("users");
    const appliedJobsCollection = client.db("jobify").collection("appliedJobs");
    const bookmarkJobsCollection = client.db("jobify").collection("bookmarkJobs");

    app.get("/jobs", async (req, res) => {
      try {
        let query = {};
        if(req.query.open_jobs){
          query = {company_name: req.query.open_jobs}
        }
        if(req.query.jobId){
          query = {_id: new ObjectId(req.query.jobId)}
        }
        if (req.query.related && req.query.id) {
          query = {
            category: req.query.related,
            _id: { $ne: new ObjectId(req.query.id) },
          };
        }
        const result = await jobsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/jobs_count", async (req, res) => {
      try {
        const result = await jobsCollection.countDocuments();
        res.send({ jobsCount: result });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/search", async (req, res) => {
      try {
        const { title, location, type } = req.query;
        let page = parseInt(req?.query?.page) || 1;
        const limit = parseInt(req?.query?.limit) || 10;
        const skip = (page - 1) * limit;
        if (title?.length < 3 || location?.length < 3 || type?.length < 3) {
          return res.status(400).send("Title, location, and type must have at least 3 characters");
        }
        const query = {
          job_title: { $regex: title || "", $options: "i" },
          location: { $regex: location || "", $options: "i" },
          job_type: { $regex: type || "", $options: "i" },
        };
        const result = await jobsCollection.find(query).skip(skip).limit(limit).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/company/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await companiesCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get('/applied_jobs', async (req, res) => {
      try {
        let query = {};
        if (req.query.email) {
          query = { candidate_email: req.query.email };
        }
        const appliedJobs = await appliedJobsCollection.find(query).toArray();
        const jobIds = appliedJobs.map(job => job.jobId);
        const jobDetails = await jobsCollection.find({ _id: { $in: jobIds.map(id => new ObjectId(id)) } }).toArray();
        const appliedJobsWithDetails = appliedJobs.map(appliedJob => {
          const jobDetail = jobDetails.find(job => job._id.toString() === appliedJob.jobId);
          return { ...appliedJob, jobDetail };
        });
        res.send(appliedJobsWithDetails);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get('/bookmark_jobs', async (req, res) => {
      try {
        let query = {};
        if (req.query.email) {
          query = { candidate_email: req.query.email };
        }
        const result = await bookmarkJobsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/companies", async (req, res) => {
      try {
        const page = parseInt(req.query?.page) - 1 || 0;
        const size = parseInt(req.query?.size) || 10;
        const name = req.query?.name;
        let query = {};
        if (name) {
          query = { company_name: name };
        }
        if(req.query.id){
          query = {_id : new ObjectId(req.query.id)}
        }
        const result = await companiesCollection.find(query).skip(page * size).limit(size).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/company_search", async (req, res) => {
      try {
        const count = await companiesCollection.countDocuments();
        res.send({ count });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get("/user/:email", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.user?.email;
        const email = req.params.email;
        if (tokenEmail && tokenEmail !== email) {
          return res.status(403).send({ message: "Forbidden Access!" });
        }
        const query = { email: email };
        const result = await usersCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.get('/role/:email',async(req,res)=>{
      const email = req.params.email;
      const result = await usersCollection.findOne({email:email})
      res.send(result)
    })

    app.get("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 0,
      }).send({ success: true });
    });

    app.post("/user", async (req, res) => {
      try {
        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.post("/auth", async (req, res) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, secret_token, {
          expiresIn: "24h",
        });
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        }).send({ success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.post("/apply", async (req, res) => {
      try {
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
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.post("/bookmark_jobs", async (req, res) => {
      try {
        const jobInfo = req.body;

        const existingBookmark = await bookmarkJobsCollection.findOne({
          jobId: jobInfo.jobId,
          candidate_email: jobInfo.candidate_email,
        });
        if (existingBookmark) {
          return res.send({ success: false });
        }

        const result = await bookmarkJobsCollection.insertOne(jobInfo);
        res.send({ result: result, success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    app.patch('/user/:email', async (req, res) => {
      try {
        const user = req.body;
        const query = { email: req.params.email };

        const updatedUser = {
          $set: {}
        };

        for (const key in user) {
          if (user.hasOwnProperty(key)) {
            updatedUser.$set[key] = user[key];
          }
        }

        await usersCollection.findOneAndUpdate(query, updatedUser);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send("Failed to update user profile.");
      }
    });

    app.delete('/user/:email', async (req, res) => {
      try {
        const query = { email: req.params.email };
        await usersCollection.deleteOne(query);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {

  }
};

run().catch(console.log);

app.get("/", (req, res) => {
  res.send("Server Running...");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
