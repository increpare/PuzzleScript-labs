#include "board_audio.hpp"

#include "board_i2c.hpp"

#include <algorithm>

#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_audio";
constexpr gpio_num_t kI2sMclk = GPIO_NUM_13;
constexpr gpio_num_t kI2sBclk = GPIO_NUM_12;
constexpr gpio_num_t kI2sWs = GPIO_NUM_10;
constexpr gpio_num_t kI2sDout = GPIO_NUM_9;
constexpr gpio_num_t kI2sDin = GPIO_NUM_11;
constexpr gpio_num_t kPowerAmpGpio = GPIO_NUM_53;
constexpr int kDefaultVolume = 80;
constexpr int kPlaybackChannels = 2;
constexpr std::size_t kMaxStereoChunkSamples = 512;

i2s_chan_handle_t g_i2s_tx_chan = nullptr;
i2s_chan_handle_t g_i2s_rx_chan = nullptr;
const audio_codec_data_if_t* g_i2s_data_if = nullptr;
esp_codec_dev_handle_t g_speaker = nullptr;
bool g_ready = false;

esp_err_t init_i2s() {
    if (g_i2s_tx_chan != nullptr && g_i2s_rx_chan != nullptr) {
        return ESP_OK;
    }

    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.auto_clear = true;
    esp_err_t err = i2s_new_channel(&chan_cfg, &g_i2s_tx_chan, &g_i2s_rx_chan);
    if (err != ESP_OK) {
        return err;
    }

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(kAudioSampleRate),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = kI2sMclk,
            .bclk = kI2sBclk,
            .ws = kI2sWs,
            .dout = kI2sDout,
            .din = kI2sDin,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    std_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_384;

    err = i2s_channel_init_std_mode(g_i2s_tx_chan, &std_cfg);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_init_std_mode(g_i2s_rx_chan, &std_cfg);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_enable(g_i2s_tx_chan);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_enable(g_i2s_rx_chan);
    if (err != ESP_OK) {
        return err;
    }

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = I2S_NUM_0,
        .rx_handle = g_i2s_rx_chan,
        .tx_handle = g_i2s_tx_chan,
    };
    g_i2s_data_if = audio_codec_new_i2s_data(&i2s_cfg);
    if (g_i2s_data_if == nullptr) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}

esp_err_t init_speaker_codec() {
    if (g_speaker != nullptr) {
        return ESP_OK;
    }
    if (g_i2s_data_if == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }

    const audio_codec_gpio_if_t* gpio_if = audio_codec_new_gpio();
    if (gpio_if == nullptr) {
        return ESP_ERR_NO_MEM;
    }

    audio_codec_i2c_cfg_t i2c_cfg = {
        .port = I2C_NUM_0,
        .addr = ES8311_CODEC_DEFAULT_ADDR,
        .bus_handle = i2c_bus(),
    };
    const audio_codec_ctrl_if_t* i2c_ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
    if (i2c_ctrl_if == nullptr) {
        return ESP_ERR_NO_MEM;
    }

    esp_codec_dev_hw_gain_t gain = {
        .pa_voltage = 5.0f,
        .codec_dac_voltage = 3.3f,
    };

    es8311_codec_cfg_t es8311_cfg = {
        .ctrl_if = i2c_ctrl_if,
        .gpio_if = gpio_if,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_DAC,
        .pa_pin = kPowerAmpGpio,
        .pa_reverted = false,
        .master_mode = false,
        .use_mclk = true,
        .digital_mic = false,
        .invert_mclk = false,
        .invert_sclk = false,
        .hw_gain = gain,
    };
    const audio_codec_if_t* es8311_dev = es8311_codec_new(&es8311_cfg);
    if (es8311_dev == nullptr) {
        return ESP_ERR_NO_MEM;
    }

    esp_codec_dev_cfg_t codec_dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
        .codec_if = es8311_dev,
        .data_if = g_i2s_data_if,
    };
    g_speaker = esp_codec_dev_new(&codec_dev_cfg);
    if (g_speaker == nullptr) {
        return ESP_ERR_NO_MEM;
    }

    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = 16,
        .channel = kPlaybackChannels,
        .channel_mask = 0,
        .sample_rate = kAudioSampleRate,
        .mclk_multiple = 0,
    };
    esp_err_t err = esp_codec_dev_open(g_speaker, &fs);
    if (err != ESP_OK) {
        return err;
    }
    return esp_codec_dev_set_out_vol(g_speaker, kDefaultVolume);
}

} // namespace

esp_err_t init_audio() {
    if (g_ready) {
        return ESP_OK;
    }

    esp_err_t err = init_i2c();
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "I2C init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = init_i2s();
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "I2S init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = init_speaker_codec();
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "ES8311 init failed: %s", esp_err_to_name(err));
        return err;
    }

    g_ready = true;
    ESP_LOGI(kTag, "ES8311 speaker ready @ %d Hz stereo", kAudioSampleRate);
    return ESP_OK;
}

bool audio_ready() {
    return g_ready;
}

esp_err_t play_pcm16_mono(const int16_t* samples, std::size_t sample_count) {
    if (!g_ready || g_speaker == nullptr || samples == nullptr || sample_count == 0) {
        return ESP_ERR_INVALID_STATE;
    }

    std::size_t offset = 0;
    while (offset < sample_count) {
        const std::size_t mono_count = std::min(kMaxStereoChunkSamples, sample_count - offset);
        int16_t stereo_chunk[kMaxStereoChunkSamples * 2];
        for (std::size_t i = 0; i < mono_count; ++i) {
            const int16_t sample = samples[offset + i];
            stereo_chunk[i * 2] = sample;
            stereo_chunk[i * 2 + 1] = sample;
        }
        const int bytes = static_cast<int>(mono_count * 2 * sizeof(int16_t));
        const esp_err_t err = esp_codec_dev_write(g_speaker, stereo_chunk, bytes);
        if (err != ESP_OK) {
            ESP_LOGW(kTag, "codec write failed: %s", esp_err_to_name(err));
            return err;
        }
        offset += mono_count;
    }
    return ESP_OK;
}

void set_audio_volume(int volume_percent) {
    if (!g_ready || g_speaker == nullptr) {
        return;
    }
    if (volume_percent < 0) {
        volume_percent = 0;
    }
    if (volume_percent > 100) {
        volume_percent = 100;
    }
    (void)esp_codec_dev_set_out_vol(g_speaker, volume_percent);
}

} // namespace ps_probe::board
