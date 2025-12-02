const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

module.exports = merge(common, {
    mode: "production",
    devtool: false, // Disable source maps in production
    optimization: {
        minimize: true,
        usedExports: true, // Tree shaking
        sideEffects: true,
    },
    performance: {
        hints: false, // Disable webpack size warnings for now
    },
});
