import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aqeleo');
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[Database Error] ${error.message}`);
    // Do not crash the process in development if MongoDB is offline; allow server to boot
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

