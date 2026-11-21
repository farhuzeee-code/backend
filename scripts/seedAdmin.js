import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';
import { Settings } from '../src/models/Settings.js';

dotenv.config();

const seedSuperAdmin = async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aqeleo';

  console.log('Connecting to MongoDB at:', mongoUri.replace(/:([^:@]+)@/, ':****@'));

  try {
    await mongoose.connect(mongoUri);
    console.log('[Seed] Database connected successfully.');

    // 1. Initialize Settings if missing
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({
        allowSignups: true,
        maxCallDurationMinutes: 60,
      });
      console.log('[Seed] Default Platform Settings initialized.');
    } else {
      console.log('[Seed] Platform Settings already present.');
    }

    // 2. Check or Create Super Admin
    const email = (process.env.SUPERADMIN_EMAIL || 'admin@aqeleo.cfd').toLowerCase();
    const name = process.env.SUPERADMIN_NAME || 'Super Admin';
    const password = process.env.SUPERADMIN_PASSWORD || 'AqeleoAdmin#2026';

    let superAdmin = await User.findOne({ email });

    if (!superAdmin) {
      const passwordHash = await User.hashPassword(password);
      superAdmin = await User.create({
        name,
        email,
        passwordHash,
        role: 'superadmin',
        status: 'active',
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
      });

      console.log('----------------------------------------------------');
      console.log('[Seed SUCCESS] First Super Admin account created:');
      console.log(`  Name:     ${name}`);
      console.log(`  Email:    ${email}`);
      console.log(`  Password: ${password}`);
      console.log(`  Role:     superadmin`);
      console.log('----------------------------------------------------');
      console.log('IMPORTANT: Use these credentials to log in to the Admin App (admin.aqeleo.cfd)');
    } else {
      console.log(`[Seed] Super Admin account already exists for ${email}. Ensuring role is 'superadmin'...`);
      superAdmin.role = 'superadmin';
      superAdmin.status = 'active';
      await superAdmin.save();
      console.log(`[Seed] Account verified as active superadmin.`);
    }

    await mongoose.disconnect();
    console.log('[Seed] Completed and disconnected.');
    process.exit(0);
  } catch (error) {
    console.error('[Seed FAILED]', error);
    process.exit(1);
  }
};

seedSuperAdmin();

