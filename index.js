import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import axios from "axios";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import path from "path";
import multer from "multer";
import 'dotenv/config';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import FormData from "form-data";
import { Readable } from "stream";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        return cb(null, "./uploads");
    },
    filename: function (req, file, cb) {
        return cb(null, `${Date.now()}-${file.originalname}`)
    },
});

const upload = multer({ storage });

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
    }
}));

app.set("views", path.resolve("views"))
app.set("view engine", "ejs");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set('view engine', 'ejs');

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
    connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("Database connection error:", err));


let c = 0;
let v = 0;

const config = {
    headers: {
        'x-api-key': process.env.API_KEY
    }
};

app.get("/", (req, res) => {
    res.render("index.ejs");
});

app.get("/login", (req, res) => {
    if (v == 1) {
        res.render("login-signup.ejs", { err: "Invalid Password! Please try again." });
        v = 0;
    } else if (v == 2) {
        res.render("login-signup.ejs", { err: "New user? Sign up below!" });
        v = 0;
    } else {
        res.render("login-signup.ejs");
    }
});

app.get("/sign-up", (req, res) => {
    if (c == 1) {
        res.render("login-signup.ejs", { value: "up", error: "This user already exists! Try logging in" });
        c = 0;
    } else {
        res.render("login-signup.ejs", { value: "up" });
    }
});

app.get("/showcase", async (req, res) => {
    // console.log(req.user);
    try {
        if (req.isAuthenticated()) {
            const result = await axios.get(`https://api.thecatapi.com/v1/images/search?size=med&mime_types=jpg&format=json&has_breeds=true&order=RANDOM&page=0&limit=21`, config);
            const favs = await db.query("SELECT image_id FROM favourites WHERE email=$1",[req.user.email]);
            // console.log(result.data);
            // console.log(favs.rows);
            let listOfKitties = [];
            let listOfFavs = [];
            result.data.forEach(element => {
                listOfKitties.push(element.id);
            });
            favs.rows.forEach(element => {
                listOfFavs.push(element.image_id);
            });
            res.render("showcase.ejs", { listOfCats: result.data,favs: listOfFavs,kitties: listOfKitties});
        } else {
            res.redirect("/login");
        }
    } catch(error) {
        console.error(error);
    }
});

app.get("/logout", (req, res) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.redirect("/");
    });
});

app.get("/uploads", async (req, res) => {
    // console.log(req.user);
    if (req.isAuthenticated()) {
        try {
            const result = await axios.get(`https://api.thecatapi.com/v1/images/?limit=10&page=0&order=DESC&sub_id=${req.user.email}`, config);
            if (result.data.length > 0) {
                res.render("uploads.ejs", { upload: result.data });
            } else {
                res.render("uploads.ejs", { message: "No uploads yet" });
            }
        } catch (err) {
            console.error(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/submit-image", (req, res) => {
    res.redirect("/uploads");
});

app.post("/submit-image", upload.single('image'), async (req, res) => {
    // console.log(req.user.email);
    // console.log(req.file);
    try {
        let formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path));
        formData.append('sub_id', req.user.email);
        const result = await axios.post(`https://api.thecatapi.com/v1/images/upload`, formData, config);
        // console.log(result.data);
        res.redirect("/uploads");
    } catch (err) {
        res.render("uploads.ejs",{errorMessage: 'Please provide the image of an animal(AI generated pictures will not be taken)!'});
        console.error(err.message);
    }
});

app.get("/delete", (req, res) => {
    res.redirect("/uploads");
});

app.post("/delete", async (req, res) => {
    let catId = req.body.id;
    try {
        await axios.delete(`https://api.thecatapi.com/v1/images/${catId}`, config);
        res.redirect("/uploads");
    } catch (err) {
        console.error(err.message);
    }
});

app.get("/search", async (req, res) => {
    res.redirect("/showcase");
});

app.post("/search", async (req, res) => {
    const id = req.body.animalid;
    try {
        const result = await axios.get(`https://api.thecatapi.com/v1/images/${id}`, config);
        const favs = await db.query("SELECT image_id FROM favourites WHERE email=$1",[req.user.email]);
        let listOfFavs = [];
        favs.rows.forEach(element => {
            listOfFavs.push(element.image_id);
        });
        // console.log(result.data);
        res.render("showcase.ejs", { oneCat: result.data,favs: listOfFavs,kitties: req.body.animalid,});
    } catch (error) {
        console.error("Not found", error.message);
        res.render("showcase.ejs", { NotFound: `Couldn't find an image matching the passed 'id' of ${id}` });
    }
});

app.get("/save",(req,res) => {
    res.redirect("/showcase");
});

app.post("/save", async (req, res) => {
    let image_id = req.body.data;
    // console.log(req.body.data);
    try {
        const outcome = await db.query("SELECT image_id FROM favourites WHERE email=$1 AND image_id=$2", [req.user.email, image_id]);
        if (outcome.rows == 0) {
            await db.query("INSERT INTO favourites(email,image_id) VALUES($1,$2)", [req.user.email, image_id]);
            res.json({ success: true, message: 'Data saved successfully!' });
        } else {
            await db.query("DELETE FROM favourites WHERE email=$1 and image_id=$2", [req.user.email, image_id]);
            res.json({ success: true, message: 'Data deleted successfully!' });
        }
    } catch (err) {
        console.error(err.message);
    }
});

app.get("/myFavs", async(req,res) => {
    let myFavCatList = [];
    try {
        if(req.isAuthenticated()) {
            const result = await db.query("SELECT image_id FROM favourites WHERE email=$1",[req.user.email]);
            if(result.rows.length > 0) {
                for(let i=0;i<result.rows.length;i++) {
                    const ID = result.rows[i].image_id;
                    const outcome = await axios.get(`https://api.thecatapi.com/v1/images/${ID}`, config);
                    myFavCatList.push(outcome.data);
                }
                // console.log(myFavCatList);
                res.render("favourites.ejs",{CatList: myFavCatList});
            } else {
                res.render("favourites.ejs",{NoCatFound: "No Favourites yet"});
            }
        } else {
            res.redirect("/login");
        }
    } catch(error) {
        console.error(error.message);
    }
});

app.get("/searchBreeds",(req,res) => {
    if(req.isAuthenticated()) {
        res.render("breeds.ejs");
    } else {
        res.redirect("/login");
    }
});

app.get("/breeds",(req,res) => {
    res.redirect("/searchBreeds");
});

app.post("/breeds", async (req,res) => {
    let enteredBreed = req.body.animalid;
    // console.log(enteredBreed);
    try {
        const result = await axios.get(`https://api.thecatapi.com/v1/breeds/search?q=${enteredBreed}&attach_image=1`,config);
        // console.log(result.data);
        if(result.data.length == 0) {
            res.render("breeds.ejs", {NotFound: "No Breed found with the entered name"});
        } else {
            const favs = await db.query("SELECT image_id FROM favourites WHERE email=$1",[req.user.email]);
            let idList = [];
            let listOfFavs = [];
            favs.rows.forEach(element => {
                listOfFavs.push(element.image_id);
            });
            result.data.forEach((obj) => {
                idList.push(obj.image.id);
            });
            res.render("breeds.ejs",{data: result.data,kitties: idList,favs: listOfFavs});
        }
    } catch(err) {
        console.error(err.message);
    }
});

app.get("/about",(req,res) => {
    if(req.isAuthenticated()) {
        res.render("about.ejs");
    } else {
        res.redirect("/login");
    }
});

app.get("/displayId", (req,res) => {
    if(req.isAuthenticated()) {
        let ids = [
            'unPP08xOZ', 'itfFA4NWS', 'KWdLHmOqc', '8r4M61iyS', 'cZHbIzC_l',
            'LSaDk6OjY', 'UhqCZ7tC4', 'bz15V3Kvg', 'TzyZJUeIM', 'dn4GBRons',
            'XLLAS_R9F', 'znCxQCEp4', 'aZii7hC77', 'BborJBuoW', '4lXnnfxac',
            'hj7Oh-SRY', 'Mdr6QqID0', '4-GdyX_fu', 'yqcbOxkWK', 'LT13Rnq3P',
            'u3V0SSE-F', '32u84LkNG', 'HT902S6ra', 'bX5VJKzVM', 'eJUcA5Wt-',
            'JFPROfGtQ', 'ZaZwqFsgj', 'Rx_gYvR2e', 'PgUVo_1n4', 'WAwazYKhH',
            'BbsNPAeop', 'g4vhUKcZX', 'AoDtRhYcL', 'G0JPLrMFg', 'wBbqm3pJa',
            'pzIURJPra', 'B1dwPGuL0', 'eDsBV6sYe', 'KpHqQPUPW', 'L_H7aef7m',
            'Dqtad3dGZ', 'rWr-g-QVX', 'JR48AEqts', '_l8H9YK5_', '9FEol9vDh',
            'xbW2bsXfK', 'J2qM5HR5K', 'Pqtwt4FCq', 'C0YfrgcOD', 'UFao82MoD',
            'wwFp9IiRd', 'GcZbVDVi8', 'fsEMVl7f5', 'eF3HSMIB_', 'bju16uKfD',
            'hz0fwFell', 'oGefY4YoG', 'CeQSKi526', 'xPkUTg4-N', 'IOjBCPLXA',
            'hd-zs3918', '8Ggv2cWP_', 'rCpfoEpQY', 'btNeFAWNP', '__tqyLW91',
            'h3ima-Zx3', 'aMcspzvtg', 'qLPz9prjF', '6KCUyqE4v', '6jbkliQh5',
            'JBkP_EJm9', 'klJJYDl2B', 'WQVXW8KXM', 'Y_z-aBHvf', 'HBWdtLpif',
            'JKITuMU25', 'BedvI_ovc', 'bRLzjs5nf', 't8oArUO-L', 'p46ys1bGF',
            '5AdhMjeEu', 'INXwfT_cp', 'E4j4aBDx9', '_PEqOH17A', 'ATYs2BetM',
            'tHKLZkKZG', 'uTG1YFzJV', 'viSRY7Ra0', 'e4K-lKOic', 'Qtncp2nRe',
            'cs_LyHtif', 'OmNwBvvUm', '8krfAgKYD', 'BDb8ZXb1v', 'TYQKhQ3mn',
            'Zi4jfH3c6', 'VsxceZVop', '2OKotXbFe', 'ybdcskeHc', 'Hb2N6tYTJ'
          ];
          res.render("ids.ejs",{idList: ids});
    } else {
        res.redirect("/login");
    }
});

app.post("/sign-up", async (req, res) => {
    const email = req.body.username;
    const password = req.body.password;
    c = 0;

    try {
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
            email,
        ]);

        if (checkResult.rows.length > 0) {
            console.log("This user already exists");
            c = 1;
            res.redirect("/sign-up");
        } else {
            //hashing the password and saving it in the database
            bcrypt.hash(password, saltRounds, async (err, hash) => {
                if (err) {
                    console.error("Error hashing password:", err);
                } else {
                    console.log("Hashed Password:", hash);
                    const result = await db.query(
                        "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
                        [email, hash]
                    );
                    const user = result.rows[0];
                    req.login(user, (err) => {
                        console.log(err);
                        res.redirect("/showcase");
                    });
                }
            });
        }
    } catch (err) {
        console.log(err);
    }
});

app.post("/login", passport.authenticate("local", {
    successRedirect: "/showcase",
    failureRedirect: "/login",
}));

passport.use(new Strategy(async function verify(username, password, cb) {
    v = 0;
    console.log(username);
    try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
            username,
        ]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const storedHashedPassword = user.password;
            bcrypt.compare(password, storedHashedPassword, (err, result) => {
                if (err) {
                    return cb(err);
                } else {
                    console.log(result);
                    if (result) {
                        return cb(null, user);
                    } else {
                        v = 1;
                        console.log("Invalid password!");
                        return cb(null, false);
                    }
                }
            });
        } else {
            v = 2;
            console.log("User does not exist!");
            return cb(null, false);
        }
    } catch (err) {
        return cb(err);
    }
}));

passport.serializeUser((user, cb) => {
    cb(null, user);
});

passport.deserializeUser((user, cb) => {
    cb(null, user);
});

app.listen(port, () => {
    console.log(`Successfully started on port ${port}`);
});