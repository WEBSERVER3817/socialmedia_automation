# Free Hosting Guide: Deploying OmniPost to the Web

This guide outlines how to host your **OmniPost Social Media Cross-Posting Dashboard** on the web **completely for free** using **GitHub**, **Render** (for server hosting), and **Supabase** (for secure, persistent database storage).

---

## 🏗️ Web Hosting Architecture & The Challenge

A typical Node.js app runs locally and saves configuration files directly to disk (like our local `config.json`). However, free hosting services (like **Render** or **Koyeb**) use **ephemeral filesystems**. 

> [!WARNING]
> **What is Ephemeral Storage?**
> Every time the free server sleeps (after 15 minutes of inactivity), restarts, or redeploys, the local disk is wiped clean and reset to the original code. If you save credentials, YouTube/Instagram tokens, or logs in a local `config.json` on the server, **they will be completely lost!**

### 💡 The Solution (Already Implemented!)
To solve this, we updated your codebase to support two secure cloud hosting features:
1. **Dynamic Redirect URIs**: Callback links automatically adapt based on where the app is running (e.g. `http://localhost:3000` vs. your live public web domain).
2. **Supabase Cloud DB integration**: If you supply a free Supabase database connection, all configuration settings, active OAuth keys, user tokens, and historical publishing logs are dynamically persisted in the cloud. They will **never** be lost when your server restarts!

---

## 🛠️ Step 1: Create a Free Database on Supabase

[Supabase](https://supabase.com/) offers a highly reliable, production-ready PostgreSQL database with a generous **free tier**.

1. Go to [Supabase](https://supabase.com/) and sign up for a free account.
2. Create a new project (e.g., named `omnipost-db`). Set a database password and choose the server region closest to you.
3. Once the project is provisioned, go to the **SQL Editor** in the left sidebar.
4. Click **New Query**, paste the following SQL script to create your persistent settings table, and click **Run**:

```sql
-- Create a persistent storage table for OmniPost credentials and tokens
create table if not exists omnipost_config (
  id text primary key,
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table omnipost_config enable row level security;

-- Create a policy allowing authenticated or anon API keys to read/write settings
create policy "Allow public read access" on omnipost_config
  for select using (true);

create policy "Allow public insert/update access" on omnipost_config
  for insert with check (true);

create policy "Allow public delete access" on omnipost_config
  for delete using (true);
```

5. Go to **Project Settings** (gear icon) ➔ **API** in the sidebar.
6. Copy and save these two values:
   - **Project URL** (under Project API keys) ➔ This will be your `SUPABASE_URL`
   - **anon / public key** ➔ This will be your `SUPABASE_ANON_KEY`

---

## 🐙 Step 2: Push Your Code to GitHub (Free Git Hosting)

To deploy automatically to Render, your codebase should live in a **GitHub repository** (public or private).

> [!NOTE]
> We have already generated a `.gitignore` file in your workspace root. This ensures that massive folders like `node_modules/`, active uploaded videos inside `uploads/`, and temporary local `config.json` files **are never uploaded to Git**, keeping your credentials secure and repository lean.

To push your project to GitHub:
1. Create a new repository on [GitHub](https://github.com/) (Private is recommended to keep your interface custom settings private).
2. Run these commands in your local project terminal:
   ```bash
   # Initialize Git repository
   git init

   # Stage all files
   git add .

   # Commit files
   git commit -m "feat: make app production ready with dynamic redirect URIs and Supabase cloud persistence"

   # Link your GitHub repository and push (Replace with your repository URL)
   git branch -M main
   git remote add origin https://github.com/your-username/your-repo-name.git
   git push -u origin main
   ```

---

## 🚀 Step 3: Deploy Your Web App to Render for Free

[Render](https://render.com/) is a cloud hosting platform with a **completely free plan** that is perfect for hosting Node.js / Express servers.

1. Go to [Render](https://render.com/) and sign up for a free account.
2. Click **New +** in the top dashboard and select **Web Service**.
3. Connect your GitHub account and select your **OmniPost repository**.
4. Configure the Web Service settings:
   - **Name**: `omnipost` (your live URL will be `https://omnipost.onrender.com` or similar)
   - **Region**: Choose the region closest to you
   - **Branch**: `main`
   - **Root Directory**: (Leave blank)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Select the **Free** tier
5. Click **Advanced** to add **Environment Variables** (this is where the magic happens!). Click "Add Environment Variable" for each of the following:

| Environment Variable Key | Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables Express production optimizations |
| `APP_URL` | `https://your-app-name.onrender.com` | **Crucial:** Your live Render public web URL (no trailing slash) |
| `SUPABASE_URL` | `https://your-project.supabase.co` | The Project URL copied from Supabase |
| `SUPABASE_ANON_KEY` | `your-anon-key-string` | The Anon API key copied from Supabase |

> [!TIP]
> **Optional Security Override:**
> If you prefer not to paste your Google and Meta secrets directly inside the web settings panel, you can pre-define them as environment variables here. This completely locks them out of the UI!
> - `GOOGLE_CLIENT_ID`
> - `GOOGLE_CLIENT_SECRET`
> - `META_CLIENT_ID`
> - `META_CLIENT_SECRET`
> - `DEMO_MODE` = `false` (forces live mode automatically)

6. Click **Create Web Service**. Render will download, build, and launch your social media dashboard!

---

## 🔑 Step 4: Update Your Developer API Portal Settings

Once your app is successfully deployed to Render, your callback domains are no longer `localhost`!

1. Open your live app link (e.g., `https://your-app-name.onrender.com`) and navigate to the **API Settings** tab.
2. Look at the **Authorized OAuth Callback Redirect URIs** card. You will notice that **OmniPost has dynamically updated** these URLs to match your live Render web service domain:
   - **YouTube**: `https://your-app-name.onrender.com/api/auth/google/callback`
   - **Meta**: `https://your-app-name.onrender.com/api/auth/meta/callback`
3. Copy these live links and paste them into your developer accounts:
   - **Google Cloud Console**: Go to API credentials, edit your OAuth 2.0 client ID, and replace the redirect URI with your new dynamic live link.
   - **Meta Developer Portal**: Go to Facebook Login settings ➔ Client OAuth settings, and add the new Meta callback live link.

---

## 🎉 Deploy Complete!
You are now fully hosted on the cloud!
- **Zero Cost**: Your web server (Render) and database (Supabase) cost absolutely $0.00/month.
- **Continuous Deployment**: Every time you make changes locally and push them (`git push`), Render will rebuild and redeploy your live site automatically.
- **Absolute Persistence**: Disconnect accounts, reconnect them, or upload videos; your configuration is safely backed up in Supabase and survives restarts perfectly.
