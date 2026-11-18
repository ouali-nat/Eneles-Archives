const path = require("path");
const devCerts = require("office-addin-dev-certs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const pkg = require("./package.json");

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const serving = Boolean(process.env.WEBPACK_SERVE);
  const buildDate = new Date().toISOString().slice(0, 10);
  const config = {
    devtool: "source-map",
    entry: {
      taskpane: ["./src/taskpane/taskpane.ts"],
      commands: "./src/commands/commands.ts",
    },
    output: {
      clean: true,
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.js$/,
          use: "source-map-loader",
          enforce: "pre",
          exclude: /node_modules/,
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
        templateParameters: {
          appVersion: pkg.version,
          buildDate,
        },
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["commands"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: "assets/*.png", to: "assets/[name][ext]" },
          { from: "src/taskpane/taskpane.css", to: "taskpane.css" },
          { from: "manifest.xml", to: "[name][ext]" },
        ],
      }),
    ],
    devServer: {
      hot: true,
      port: 47821,
      headers: {
        "Cache-Control": "no-store",
      },
      static: { directory: path.resolve(__dirname, "dist") },
      server: serving
        ? {
            type: "https",
            options: dev ? await getHttpsOptions() : {},
          }
        : undefined,
      proxy: [
        {
          context: ["/local-api"],
          target: "http://127.0.0.1:47822",
          pathRewrite: { "^/local-api": "" },
        },
      ],
    },
  };

  return config;
};
