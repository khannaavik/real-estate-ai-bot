/** @type {import('next').NextConfig} */
const nextConfig = {
    // ensure Next uses your PostCSS config
    webpack(config) {
        return config;
    }
};

module.exports = nextConfig;
