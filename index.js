const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");
const moment = require("moment");
const port = process.env.PORT || 3473;
const mongoURI = process.env.MONGO_URI;
const secret_token = process.env.ACCESS_TOKEN_SECRET;
const SSLCommerzPayment = require("sslcommerz-lts");
const nodemailer = require("nodemailer");

//transporter
const sendEmail = async (email, emailData) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: `"Jobify" <${process.env.SMTP_EMAIL}>`,
    to: email,
    subject: emailData.subject,
    html: emailData.body,
  });
};

//sslcommerz details
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASSWORD;
const is_live = false;

// Initialize Express app
const app = express();

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
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
    const ordersCollection = client.db("jobify").collection("orders");
    const appliedJobsCollection = client.db("jobify").collection("appliedJobs");
    const bookmarkJobsCollection = client
      .db("jobify")
      .collection("bookmarkJobs");

    //get all jobs
    app.get("/jobs", async (req, res) => {
      try {
        let query = {};
        if (req.query.open_jobs) {
          query = { company_name: req.query.open_jobs };
        }
        if (req.query.jobId) {
          query = { _id: new ObjectId(req.query.jobId) };
        }
        if (req.query.related && req.query.id) {
          query = {
            category: req.query.related,
            _id: { $ne: new ObjectId(req.query.id) },
          };
        }
        if (req.query.featured) {
          query.featured = req.query.featured.toLowerCase() === "true";
        }
        const result = await jobsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get a single job details
    app.get('/job_details/:id',async(req,res)=>{
      const job = await jobsCollection.findOne({_id: new ObjectId(req.params.id)})
      const company = await companiesCollection.findOne({company_name: job?.company_name})
      const related_jobs = await jobsCollection.find({
        job_tags: {$in: job?.job_tags},
        _id: { $ne: new ObjectId(job?._id) },
      }).toArray()
      const {benefits,company_vision,featured,plan,job_limit,resume_access_limit,resume_visibility_limit,company_about,location,description,...companyDetails} = company;
      const {job_tags,company_email,applications,highlight,...jobDetail} = job
      const jobDetails = {job: jobDetail,company: companyDetails, related_jobs:related_jobs}
      res.send(jobDetails)
    })

    //get job count for pagination
    app.get("/jobs_count", async (req, res) => {
      try {
        const result = await jobsCollection.countDocuments();
        res.send({ jobsCount: result });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //search and pagination [will replace later]
    app.get("/search", async (req, res) => {
      try {
        const { title, location, type } = req.query;
        let page = parseInt(req?.query?.page) || 1;
        const limit = parseInt(req?.query?.limit) || 10;
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
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get all candidates
    app.get("/candidates", async (req, res) => {
      let query = {};
      if (req.query.id) {
        query = { jobId: req.query.id };
      }
      const applications = await appliedJobsCollection.find(query).toArray();
      if (!req.query.id) {
        return res.send(applications);
      }
      const candidate_emails = applications.map(
        (application) => application.candidate_email
      );
      const jobDetails = await jobsCollection.findOne({
        _id: new ObjectId(req.query.id),
      });
      const candidates = await usersCollection
        .find({ email: { $in: candidate_emails } })
        .toArray();
      const detailedApplications = applications.map((application) => {
        const candidate = candidates.find(
          (user) => user.email === application.candidate_email
        );
        const { role, _id, ...candidateWithoutRole } = candidate;
        const { company_name, job_title, job_nature } = jobDetails;
        return {
          ...application,
          ...candidateWithoutRole,
          company_name,
          job_title,
          job_nature,
        };
      });
      res.send(detailedApplications);
    });

    //get candidate dashbaord state
    app.get("/candidate_stats/:email", async (req, res) => {
      const query = { candidate_email: req.params.email };
      const appliedJobs = await appliedJobsCollection.find(query).toArray();
      const bookmarkJobs = await bookmarkJobsCollection.find(query).toArray();
      res.send({
        appliedJobsCount: appliedJobs.length,
        bookmarkJobsCount: bookmarkJobs.length,
      });
    });

    //get a single company
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

    //get applied jobs data
    app.get("/applied_jobs/:email", async (req, res) => {
      try {
        let query = { candidate_email: req.params.email };

        const appliedJobs = await appliedJobsCollection.find(query).toArray();
        const jobIds = appliedJobs.map((job) => job.jobId);
        const jobDetails = await jobsCollection
          .find({ _id: { $in: jobIds.map((id) => new ObjectId(id)) } })
          .toArray();
        const appliedJobsWithDetails = appliedJobs.map((appliedJob) => {
          const jobDetail = jobDetails.find(
            (job) => job._id.toString() === appliedJob.jobId
          );
          return { ...appliedJob, jobDetail };
        });
        res.send(appliedJobsWithDetails);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get bookmark jobs
    app.get("/bookmark_jobs", async (req, res) => {
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

    //get all companies
    app.get("/companies", async (req, res) => {
      try {
        const page = parseInt(req.query?.page) - 1 || 0;
        const size = parseInt(req.query?.size) || 10;
        const name = req.query?.name;
        let query = {};
        if (name) {
          query = { company_name: name };
        }
        if (req.query.id) {
          query = { _id: new ObjectId(req.query.id) };
        }
        if (req.query.email) {
          query = { email: req.query.email };
        }
        if (req.query.featured) {
          query.featured = req.query.featured.toLowerCase() === "true";
        }
        const result = await companiesCollection
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get job alerts
    app.get("/job_alert", async (req, res) => {
      let query = {};
      if (req.query.preference) {
        const preferences = req.query.preference.split(",");
        query = {
          $or: preferences.map((pref) => ({
            job_title: { $regex: new RegExp(pref, "i") },
          })),
        };
      }

      try {
        const result = await jobsCollection.find(query).toArray();
        res.json(result);
      } catch (error) {
        console.error(error);
        res.status(500).send("An error occurred while fetching job alerts");
      }
    });

    //company count for pagination
    app.get("/company_search", async (req, res) => {
      try {
        const count = await companiesCollection.countDocuments();
        res.send({ count });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //user data based by email [need to fix role]
    app.get("/user/:email", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.user?.email;
        const email = req.params.email;

        if (tokenEmail && tokenEmail !== email) {
          console.log("Email mismatch. Forbidden Access!");
          return res.status(403).send({ message: "Forbidden Access!" });
        }

        const query = { email: email };
        const result = await usersCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Server Error:", error);
        res.status(500).send("Server Error");
      }
    });

    //check user role
    app.get("/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email: email });
      res.send({ role: result?.role });
    });

    //clearing token
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

    //insert user to db
    app.post("/user", async (req, res) => {
      try {
        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //set cookie to db
    app.post("/auth", async (req, res) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, secret_token, {
          expiresIn: "24h",
        });
        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //add job to db
    app.post("/apply", verifyToken, async (req, res) => {
      try {
        const jobInfo = req.body;
    
        if (req.user.role === "company") {
          return res.send({ message: "Company Can't Apply..." });
        }
    
        const existingApplication = await appliedJobsCollection.findOne({
          jobId: jobInfo.jobId,
          candidate_email: jobInfo.candidate_email,
        });
    
        if (existingApplication) {
          return res.send({ message: "You have already applied..." });
        }
    
        await jobsCollection.updateOne(
          { _id: new ObjectId(jobInfo.jobId) },
          { $inc: { applications: 1 } }
        );
    
        const job = await jobsCollection
          .find({ _id: new ObjectId(jobInfo.jobId) })
          .project({ _id: 0, job_title: 1, company_name: 1 })
          .limit(1)
          .toArray();
        
        const jobDetails = job[0];
    
        const result = await appliedJobsCollection.insertOne(jobInfo);
    
        await sendEmail(jobInfo.candidate_email, {
          subject: `You Applied On Jobify`,
          body: `<p>You applied on <strong>${jobDetails.job_title}</strong></p><br><p>Wait until ${jobDetails.company_name} reviews your application</p><br><p>Jobify Team</p>`
        });
    
        res.send(result);
      } catch (error) {
        console.error("Error in /apply route:", error);
        res.status(500).send("Server Error");
      }
    });

    //add bookmark job
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

    //create a job to db and ui
    app.post("/jobs", verifyToken, async (req, res) => {
      const role = req.user.role;
      const jobInfo = req.body;
      if (role !== "company") {
        return res.send({ message: "Only Company Can Add Job" });
      }
      const result = await jobsCollection.insertOne(jobInfo);
      if (result.insertedId) {
        await companiesCollection.findOneAndUpdate(
          { _id: new ObjectId(jobInfo?.companyId) },
          {
            $set: {
              $inc: { job_limit: -1 },
            },
          }
        );
      }
      res.send(result);
    });

    //purchase plan route
    app.post("/plans", async (req, res) => {
      const planDetails = req.body;
      const tran_id = new ObjectId().toString();
      const data = {
        total_amount: planDetails?.price,
        currency: "BDT",
        tran_id: tran_id, // use unique tran_id for each api call
        success_url: `${process.env.SERVER_API}/payment/success`,
        fail_url: "http://localhost:3030/fail",
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: planDetails?.plan,
        product_category: "Electronic",
        product_profile: "general",
        cus_name: "Customer Name",
        cus_email: "customer@example.com",
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });
        const order = { ...planDetails, tran_id, status: false, active: false };

        const result = ordersCollection.insertOne(order);
      });

      app.get("/tran_info", (req, res) => {
        const data = {
          tran_id,
        };
        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        sslcz.transactionQueryByTransactionId(data).then((data) => {
          res.send(data.element);
        });
      });

      app.post("/payment/success", async (req, res) => {
        const result = await ordersCollection.updateOne(
          { tran_id },
          {
            $set: {
              status: true,
              active: true,
            },
          }
        );
        await companiesCollection.findOneAndUpdate(
          { email: planDetails?.user_email },
          {
            $set: {
              plan: planDetails?.plan,
              job_limit:
                (planDetails?.plan === "basic" && 5) ||
                (planDetails?.plan === "standard" && 10) ||
                (planDetails?.plan === "premium" && 20),
              resume_access_limit:
                (planDetails?.plan === "basic" && 10) ||
                (planDetails?.plan === "standard" && 20) ||
                (planDetails?.plan === "premium" && 50),
              resume_visibility_limit:
                (planDetails?.plan === "basic" && 10) ||
                (planDetails?.plan === "standard" && 20) ||
                (planDetails?.plan === "premium" && 50),
            },
          }
        );
        if (result.modifiedCount > 0) {
          res.redirect("http://localhost:5173/payment/success");
        }
      });
    });

    //get order/plan info
    app.get("/orders", async (req, res) => {
      let query = {};
      if (req.query.active) {
        query = { active: true };
      }
      if (req.query.status && req.query.email) {
        query = { user_email: req.params.email, status: true };
      }
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    //update user info
    app.patch("/user/:email", async (req, res) => {
      try {
        const user = req.body;
        const query = { email: req.params.email };

        const updatedUser = {
          $set: {},
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

    //update applied job status
    app.patch("/applied_job/:id", async (req, res) => {
      const { status, email } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updateStatus = {
        $set: { status: status },
      };
      const result = await appliedJobsCollection.updateOne(query, updateStatus);
      res.send(result);
      await sendEmail(email, {
        subject: `Your Job Status Changed!`,
        body: `<p>Your Applied Jobs Status Changed To <strong>${status}</strong></p><br><p>Team Jobify</p><p>Jobify</p>`,
      });
    });

    //update job in db
    app.patch("/job/:id", async (req, res) => {
      const job = req.body;
      const jobId = req.params.id;
      const query = { _id: new ObjectId(jobId) };

      const updatedJob = {
        $set: {},
      };
      for (const key in job) {
        if (job.hasOwnProperty(key)) {
          updatedJob.$set[key] = job[key];
        }
      }
      await jobsCollection.findOneAndUpdate(query, updatedJob);
      res.send({ success: true });
    });

    //update company info in db
    app.patch("/company/:email", async (req, res) => {
      try {
        const company = req.body;
        const company_email = req.params.email;
        const query = { email: company_email };

        const updatedCompany = {
          $set: {},
        };
        for (const key in company) {
          if (company.hasOwnProperty(key)) {
            updatedCompany.$set[key] = company[key];
          }
        }
        const result = await companiesCollection.findOneAndUpdate(
          query,
          updatedCompany
        );
        res.send({ success: true });
      } catch (error) {
        console.log(error);
      }
    });

    //delete user from db and firebase
    app.delete("/user/:email", async (req, res) => {
      try {
        const query = { email: req.params.email };
        await usersCollection.deleteOne(query);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //delete company from db and firebase
    app.delete("/company/:email", async (req, res) => {
      try {
        const query = { email: req.params.email };
        await companiesCollection.deleteOne(query);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //cron jobs
    cron.schedule("0 0 * * *", async () => {
      try {
        const currentDate = moment().startOf("day");

        // Find all jobs with expiration dates before today
        const expiredJobs = await jobsCollection
          .find({
            expiration_date: { $lt: currentDate.format("MMMM D, YYYY") },
            status: true, // Assuming status is a boolean field indicating whether the job is active or not
          })
          .toArray();

        // Update the status of expired jobs
        for (const job of expiredJobs) {
          await jobsCollection.updateOne(
            { _id: new ObjectId(job._id) },
            { $set: { status: false } } // Set status to false for expired jobs
          );
        }
      } catch (error) {
        console.error("Error occurred during cron job:", error);
      }
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
  console.log(`Server running on port ${port}`);
});
