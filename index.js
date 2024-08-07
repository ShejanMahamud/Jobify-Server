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
const stripe = require("stripe")(process.env.SK_TEST);
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
    origin: ["http://localhost:5173", "https://jobify-web.netlify.app"],
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
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

// Main function to run MongoDB client and set up routes
const run = async () => {
  try {
    // await client.connect();

    const jobsCollection = client.db("jobify").collection("jobs");
    const companiesCollection = client.db("jobify").collection("companies");
    const usersCollection = client.db("jobify").collection("users");
    const ordersCollection = client.db("jobify").collection("orders");
    const appliedJobsCollection = client.db("jobify").collection("appliedJobs");
    const candidatesCollection = client.db("jobify").collection('candidates')
    const bookmarkJobsCollection = client
      .db("jobify")
      .collection("bookmarkJobs");

    //get all jobs
    app.get("/jobs", async (req, res) => {
      const page = parseInt(req?.query?.page) || 1;
      const limit = parseInt(req?.query?.limit) || 10;
      const skip = (page - 1) * limit;
      try {
        let query = {};
        if (req.query.jobId) {
          query._id = new ObjectId(req.query.jobId);
        }
        if (req.query.featured) {
          query.featured = req.query.featured.toLowerCase() === "true";
        }
        if (req.query.company) {
          query.company = { company_name: req.query.company };
        }

        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "companies",
              localField: "company_name",
              foreignField: "company_name",
              as: "company_info",
            },
          },
          { $unwind: "$company_info" },
          {
            $project: {
              _id: 1,
              company_name: 1,
              job_title: 1,
              job_tags: 1,
              job_role: 1,
              job_salary_min: 1,
              job_salary_max: 1,
              job_salary_type: 1,
              education: 1,
              experience: 1,
              job_type: 1,
              vacancies: 1,
              expiration_date: 1,
              job_level: 1,
              location: 1,
              posted_date: 1,
              category: 1,
              status: 1,
              featured: 1,
              company_logo: "$company_info.company_logo",
            },
          },
        ];
        const count = await jobsCollection.countDocuments();
        const result = await jobsCollection
          .aggregate(pipeline)
          .skip(skip)
          .limit(limit)
          .toArray();
        res.send({ jobs: result, jobsCount: count });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get all open jobs
    app.get("/open_jobs/:email", async (req, res) => {
      const result = await jobsCollection
        .find({ company_email: req.params.email })
        .toArray();
      res.send(result);
    });

    //job details with a id
    app.get("/job_details/:id", async (req, res) => {
      try {
        const pipeline = [
          {
            $match: {
              _id: new ObjectId(req.params.id),
            },
          },
          {
            $lookup: {
              from: "companies",
              localField: "company_name",
              foreignField: "company_name",
              as: "company_info",
            },
          },
          {
            $unwind: "$company_info",
          },
          {
            $lookup: {
              from: "jobs",
              let: { job_tags: "$job_tags", job_id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $in: ["$job_tags", "$$job_tags"] },
                        { $ne: ["$_id", "$$job_id"] },
                      ],
                    },
                  },
                },
              ],
              as: "related_jobs",
            },
          },
          {
            $project: {
              "company_info.benefits": 0,
              "company_info.company_vision": 0,
              "company_info.featured": 0,
              "company_info.plan": 0,
              "company_info.job_limit": 0,
              "company_info.resume_access_limit": 0,
              "company_info.resume_visibility_limit": 0,
              "company_info.company_about": 0,
              "company_info.location": 0,
              "company_info.description": 0,
              job_tags: 0,
              company_email: 0,
              applications: 0,
              highlight: 0,
            },
          },
          {
            $addFields: {
              company: "$company_info",
              related_jobs: "$related_jobs",
            },
          },
          {
            $project: {
              company_info: 0
            }
          }
        ];

        const result = await jobsCollection.aggregate(pipeline).toArray();

        if (result.length === 0) {
          return res.status(404).send({ error: "Job not found" });
        }

        const jobDetails = result[0];

        res.send(jobDetails);
      } catch (error) {
        res.status(500).send({ error: error.message });
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
        const count = await jobsCollection.countDocuments();
        const result = await jobsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();
        res.send({ jobs: result, jobsCount: count });
      } catch (error) {
        res.status(500).send("Server Error");
      }
    });

    //get all candidates
    app.get("/candidates", async (req, res) => {
      const query = req.query.id ? { jobId: req.query.id } : {};

      const pipeline = [
        {
          $match: query,
        },
        {
          $lookup: {
            from: "jobsCollection",
            localField: "jobId",
            foreignField: "_id",
            as: "jobDetails",
          },
        },
        {
          $unwind: {
            path: "$jobDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "usersCollection",
            localField: "candidate_email",
            foreignField: "email",
            as: "candidateDetails",
          },
        },
        {
          $unwind: {
            path: "$candidateDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            company_name: "$jobDetails.company_name",
            job_title: "$jobDetails.job_title",
            job_nature: "$jobDetails.job_nature",
            candidate_name: "$candidateDetails.name",
            candidate_email: "$candidateDetails.email",
            candidate_phone: "$candidateDetails.phone",
          },
        },
        {
          $project: {
            jobDetails: 0,
            candidateDetails: 0,
          },
        },
      ];

      try {
        const applications = await appliedJobsCollection
          .aggregate(pipeline)
          .toArray();
        res.send(applications);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //get a single company
    app.get("/company/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const pipeline = [
          {
            $match: query,
          },
          {
            $lookup: {
              from: "jobs", // The collection to join
              localField: "company_name", // Field from the companies collection
              foreignField: "company_name", // Field from the jobs collection
              as: "open_jobs", // The name of the new array field to add to the output documents
            },
          },
          {
            $project: {
              company_name: 1,
              description: 1,
              founded_in: 1,
              organization_type: 1,
              company_size: 1,
              phone: 1,
              email: 1,
              website: 1,
              company_logo: 1,
              company_category: 1,
              benefits: 1,
              company_vision: 1,
              location: 1,
              linkedin:1,
              github: 1,
              open_jobs: {
                job_title:1,
                company_name:1,
                location:1,
                job_salary_min:1,
                job_salary_max:1,
                _id:1,
                job_type:1,
                featured:1,
                company_logo:1,
              },
            },
          },
        ];
        const result = await companiesCollection.aggregate(pipeline).toArray();
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
          query.featured = {featured: true}
        }

        const pipeline = [
          {
            $match: query,
          },
          {
            $lookup: {
              from: "jobs",
              localField: "company_name",
              foreignField: "company_name",
              as: "jobs",
            },
          },
          {
            $project: {
              company_name: 1,
              description: 1,
              founded_in: 1,
              organization_type: 1,
              company_size: 1,
              phone: 1,
              email: 1,
              website: 1,
              company_logo: 1,
              company_category: 1,
              benefits: 1,
              company_vision: 1,
              location: 1,
              open_jobs: { $size: "$jobs" },
            },
          },
          { $skip: page * size },
          {
            $limit: size,
          },
        ];
        const count = await companiesCollection.countDocuments();
        const result = await companiesCollection.aggregate(pipeline).toArray();
        res.send({ companies: result, count: count });
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
        const email = req.params.email;
        const query = { email: email };
        const result = await usersCollection.findOne(query);
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

    //candidate stats for candidate db
    app.get('/candidate_stats/:email',async(req,res)=>{
      const applied_jobs = await appliedJobsCollection.countDocuments({candidate_email:req.params.email})
      const bookmark_jobs = await bookmarkJobsCollection.countDocuments({candidate_email:req.params.email})
      res.send({applied_jobs,bookmark_jobs})
    })

    //get candidates details for candidate db
    app.get('/candidate/:email',async(req,res)=>{
      const result = await candidatesCollection.findOne({candidate_email:req.params.email})
      res.status(200).send(result)
    })

    //saved a candidate info
    app.post('/candidates',async(req,res)=>{
      const candidate = req.body;
      const result = await candidatesCollection.insertOne(candidate)
      if(result.insertedId){
        res.send({success:true})
      }
    })

    //clearing Token
    app.post("/logout", async (req, res) => {
      const user = req.body;
      console.log("logging out", user);
      res
        .clearCookie("token", { ...cookieOptions, maxAge: 0 })
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
        res.cookie("token", token, cookieOptions).send({ success: true });
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
          body: `<p>You applied on <strong>${jobDetails.job_title}</strong></p><br><p>Wait until ${jobDetails.company_name} reviews your application</p><br><p>Jobify Team</p>`,
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
      const jobInfo = req.body;
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

    //ssl-commerz payment
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

    //stripe payment
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //save stripe payment to db
    app.post("/plans_stripe", async (req, res) => {
      const payment_info = req.body;
      const result = await ordersCollection.insertOne(payment_info);
      await companiesCollection.findOneAndUpdate(
        { email: payment_info?.user_email },
        {
          $set: {
            plan: payment_info?.plan,
            job_limit:
              (payment_info?.plan === "basic" && 5) ||
              (payment_info?.plan === "standard" && 10) ||
              (payment_info?.plan === "premium" && 20),
            resume_access_limit:
              (payment_info?.plan === "basic" && 10) ||
              (payment_info?.plan === "standard" && 20) ||
              (payment_info?.plan === "premium" && 50),
            resume_visibility_limit:
              (payment_info?.plan === "basic" && 10) ||
              (payment_info?.plan === "standard" && 20) ||
              (payment_info?.plan === "premium" && 50),
          },
        }
      );
      res.send(result);
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

    //update candidate info
    app.patch("/candidate/:email", async (req, res) => {
      try {
        const user = req.body;
        const query = { candidate_email: req.params.email };

        const updatedUser = {
          $set: user,
        };

        await candidatesCollection.findOneAndUpdate(query, updatedUser);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send("Failed to update user profile.");
      }
    });

    app.patch('/user/:email',async(req,res)=>{
      const result = await usersCollection.updateOne({email: req.params.email},{
        $set: req.body
      })
      if(result.modifiedCount > 0){
        res.send({success: true})
      }
    })

    //update applied job statu
    app.patch("/change_status/:id", async (req, res) => {
      const { email, status } = req.body;
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

    app.patch(`/interview/:id`, async (req, res) => {
      const interviewInfo = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updateStatus = {
        $set: {},
      };
      for (const key in interviewInfo) {
        if (interviewInfo.hasOwnProperty) {
          updateStatus.$set[key] = interviewInfo[key];
        }
      }
      const result = await appliedJobsCollection.updateOne(query, updateStatus);
      if (result.modifiedCount > 0) {
        await sendEmail(interviewInfo.email, {
          subject: `Your Job Status Changed!`,
          body: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2 style="color: #4CAF50;">Job Status Update from Jobify</h2>
            <p>Dear Applicant,</p>
            <p>We are pleased to inform you that your job application status has changed to <strong>${
              interviewInfo.status
            }</strong>.</p>
            <p>Here are the details of your upcoming interview:</p>
            <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Interview Date:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${
                  interviewInfo.interview_date
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Interview Time:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${
                  interviewInfo.interview_time
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Location:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${
                  interviewInfo?.interview_location ||
                  interviewInfo?.interview_link
                }</td>
              </tr>
            </table>
            <p>${interviewInfo.interview_query}</p>
            <br>
            <p>Best regards,</p>
            <p><strong>Team Jobify</strong></p>
            <p style="color: #888;">Jobify</p>
          </div>
        `,
        });
      }
      res.send(result);
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
        const query = { company_email: company_email };

        const updatedCompany = {
          $set: company,
        };
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

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
